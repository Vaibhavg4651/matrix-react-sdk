/*
Copyright 2022 - 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { mocked } from "jest-mock";
import { PushRuleActionName, TweakName } from "matrix-js-sdk/src/@types/PushRules";
import { NotificationCountType, Room } from "matrix-js-sdk/src/models/room";
import { EventStatus, PendingEventOrdering } from "matrix-js-sdk/src/matrix";

import type { MatrixClient } from "matrix-js-sdk/src/matrix";
import { mkEvent, mkRoom, muteRoom, stubClient } from "./test-utils";
import {
    getRoomNotifsState,
    RoomNotifState,
    getUnreadNotificationCount,
    determineUnreadState,
} from "../src/RoomNotifs";
import { NotificationColor } from "../src/stores/notifications/NotificationColor";

describe("RoomNotifs test", () => {
    let client: jest.Mocked<MatrixClient>;

    beforeEach(() => {
        client = stubClient() as jest.Mocked<MatrixClient>;
    });

    it("getRoomNotifsState handles rules with no conditions", () => {
        mocked(client).pushRules = {
            global: {
                override: [
                    {
                        rule_id: "!roomId:server",
                        enabled: true,
                        default: false,
                        actions: [],
                    },
                ],
            },
        };
        expect(getRoomNotifsState(client, "!roomId:server")).toBe(null);
    });

    it("getRoomNotifsState handles guest users", () => {
        mocked(client).isGuest.mockReturnValue(true);
        expect(getRoomNotifsState(client, "!roomId:server")).toBe(RoomNotifState.AllMessages);
    });

    it("getRoomNotifsState handles mute state", () => {
        const room = mkRoom(client, "!roomId:server");
        muteRoom(room);
        expect(getRoomNotifsState(client, room.roomId)).toBe(RoomNotifState.Mute);
    });

    it("getRoomNotifsState handles mentions only", () => {
        (client as any).getRoomPushRule = () => ({
            rule_id: "!roomId:server",
            enabled: true,
            default: false,
            actions: [PushRuleActionName.DontNotify],
        });
        expect(getRoomNotifsState(client, "!roomId:server")).toBe(RoomNotifState.MentionsOnly);
    });

    it("getRoomNotifsState handles noisy", () => {
        (client as any).getRoomPushRule = () => ({
            rule_id: "!roomId:server",
            enabled: true,
            default: false,
            actions: [{ set_tweak: TweakName.Sound, value: "default" }],
        });
        expect(getRoomNotifsState(client, "!roomId:server")).toBe(RoomNotifState.AllMessagesLoud);
    });

    describe("getUnreadNotificationCount", () => {
        const ROOM_ID = "!roomId:example.org";
        const THREAD_ID = "$threadId";

        let room: Room;
        beforeEach(() => {
            room = new Room(ROOM_ID, client, client.getUserId()!);
        });

        it("counts room notification type", () => {
            expect(getUnreadNotificationCount(room, NotificationCountType.Total)).toBe(0);
            expect(getUnreadNotificationCount(room, NotificationCountType.Highlight)).toBe(0);
        });

        it("counts notifications type", () => {
            room.setUnreadNotificationCount(NotificationCountType.Total, 2);
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 1);

            expect(getUnreadNotificationCount(room, NotificationCountType.Total)).toBe(2);
            expect(getUnreadNotificationCount(room, NotificationCountType.Highlight)).toBe(1);
        });

        it("counts predecessor highlight", () => {
            room.setUnreadNotificationCount(NotificationCountType.Total, 2);
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 1);

            const OLD_ROOM_ID = "!oldRoomId:example.org";
            const oldRoom = new Room(OLD_ROOM_ID, client, client.getUserId()!);
            oldRoom.setUnreadNotificationCount(NotificationCountType.Total, 10);
            oldRoom.setUnreadNotificationCount(NotificationCountType.Highlight, 6);

            client.getRoom.mockReset().mockReturnValue(oldRoom);

            const predecessorEvent = mkEvent({
                event: true,
                type: "m.room.create",
                room: ROOM_ID,
                user: client.getUserId()!,
                content: {
                    creator: client.getUserId(),
                    room_version: "5",
                    predecessor: {
                        room_id: OLD_ROOM_ID,
                        event_id: "$someevent",
                    },
                },
                ts: Date.now(),
            });
            room.addLiveEvents([predecessorEvent]);

            expect(getUnreadNotificationCount(room, NotificationCountType.Total)).toBe(8);
            expect(getUnreadNotificationCount(room, NotificationCountType.Highlight)).toBe(7);
        });

        it("counts thread notification type", () => {
            expect(getUnreadNotificationCount(room, NotificationCountType.Total, THREAD_ID)).toBe(0);
            expect(getUnreadNotificationCount(room, NotificationCountType.Highlight, THREAD_ID)).toBe(0);
        });

        it("counts notifications type", () => {
            room.setThreadUnreadNotificationCount(THREAD_ID, NotificationCountType.Total, 2);
            room.setThreadUnreadNotificationCount(THREAD_ID, NotificationCountType.Highlight, 1);

            expect(getUnreadNotificationCount(room, NotificationCountType.Total, THREAD_ID)).toBe(2);
            expect(getUnreadNotificationCount(room, NotificationCountType.Highlight, THREAD_ID)).toBe(1);
        });
    });

    describe("determineUnreadState", () => {
        let room: Room;

        beforeEach(() => {
            room = new Room("!room-id:example.com", client, "@user:example.com", {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
        });

        it("shows nothing by default", async () => {
            const { color, symbol, count } = determineUnreadState(room);

            expect(symbol).toBe(null);
            expect(color).toBe(NotificationColor.None);
            expect(count).toBe(0);
        });

        it("indicates if there are unsent messages", async () => {
            const event = mkEvent({
                event: true,
                type: "m.message",
                user: "@user:example.org",
                content: {},
            });
            event.status = EventStatus.NOT_SENT;
            room.addPendingEvent(event, "txn");

            const { color, symbol, count } = determineUnreadState(room);

            expect(symbol).toBe("!");
            expect(color).toBe(NotificationColor.Unsent);
            expect(count).toBeGreaterThan(0);
        });

        it("indicates the user has been invited to a channel", async () => {
            room.updateMyMembership("invite");

            const { color, symbol, count } = determineUnreadState(room);

            expect(symbol).toBe("!");
            expect(color).toBe(NotificationColor.Red);
            expect(count).toBeGreaterThan(0);
        });

        it("shows nothing for muted channels", async () => {
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 99);
            room.setUnreadNotificationCount(NotificationCountType.Total, 99);
            muteRoom(room);

            const { color, count } = determineUnreadState(room);

            expect(color).toBe(NotificationColor.None);
            expect(count).toBe(0);
        });

        it("uses the correct number of unreads", async () => {
            room.setUnreadNotificationCount(NotificationCountType.Total, 999);

            const { color, count } = determineUnreadState(room);

            expect(color).toBe(NotificationColor.Grey);
            expect(count).toBe(999);
        });

        it("uses the correct number of highlights", async () => {
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 888);

            const { color, count } = determineUnreadState(room);

            expect(color).toBe(NotificationColor.Red);
            expect(count).toBe(888);
        });
    });
});
