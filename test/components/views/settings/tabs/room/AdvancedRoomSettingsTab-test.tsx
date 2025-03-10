/*
Copyright 2023 The Matrix.org Foundation C.I.C.

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

import React from "react";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import { MatrixClient } from "matrix-js-sdk/src/client";
import { Room } from "matrix-js-sdk/src/models/room";
import { mocked } from "jest-mock";
import { EventType, MatrixEvent } from "matrix-js-sdk/src/matrix";

import AdvancedRoomSettingsTab from "../../../../../../src/components/views/settings/tabs/room/AdvancedRoomSettingsTab";
import { mkEvent, mkStubRoom, stubClient } from "../../../../../test-utils";
import dis from "../../../../../../src/dispatcher/dispatcher";
import { Action } from "../../../../../../src/dispatcher/actions";
import { MatrixClientPeg } from "../../../../../../src/MatrixClientPeg";
import SettingsStore from "../../../../../../src/settings/SettingsStore";

jest.mock("../../../../../../src/dispatcher/dispatcher");

describe("AdvancedRoomSettingsTab", () => {
    const roomId = "!room:example.com";
    let cli: MatrixClient;
    let room: Room;

    const renderTab = (): RenderResult => {
        return render(<AdvancedRoomSettingsTab roomId={roomId} closeSettingsFn={jest.fn()} />);
    };

    beforeEach(() => {
        stubClient();
        cli = MatrixClientPeg.get();
        room = mkStubRoom(roomId, "test room", cli);
        mocked(cli.getRoom).mockReturnValue(room);
        mocked(dis.dispatch).mockReset();
        mocked(room.findPredecessor).mockImplementation((msc3946: boolean) =>
            msc3946
                ? { roomId: "old_room_id_via_predecessor", eventId: null }
                : { roomId: "old_room_id", eventId: "tombstone_event_id" },
        );
    });

    it("should render as expected", () => {
        const tab = renderTab();
        expect(tab.asFragment()).toMatchSnapshot();
    });

    it("should display room ID", () => {
        const tab = renderTab();
        tab.getByText(roomId);
    });

    it("should display room version", () => {
        mocked(room.getVersion).mockReturnValue("custom_room_version_1");

        const tab = renderTab();
        tab.getByText("custom_room_version_1");
    });

    function mockStateEvents(room: Room) {
        const createEvent = mkEvent({
            event: true,
            user: "@a:b.com",
            type: EventType.RoomCreate,
            content: { predecessor: { room_id: "old_room_id", event_id: "tombstone_event_id" } },
            room: room.roomId,
        });

        // Because we're mocking Room.findPredecessor, it may not be necessary
        // to provide the actual event here, but we do need the create event,
        // and in future this may be needed, so included for symmetry.
        const predecessorEvent = mkEvent({
            event: true,
            user: "@a:b.com",
            type: EventType.RoomPredecessor,
            content: { predecessor_room_id: "old_room_id_via_predecessor" },
            room: room.roomId,
        });

        type GetStateEvents2Args = (eventType: EventType | string, stateKey: string) => MatrixEvent | null;

        const getStateEvents = jest.spyOn(
            room.currentState,
            "getStateEvents",
        ) as unknown as jest.MockedFunction<GetStateEvents2Args>;

        getStateEvents.mockImplementation((eventType: string | null, _key: string) => {
            switch (eventType) {
                case EventType.RoomCreate:
                    return createEvent;
                case EventType.RoomPredecessor:
                    return predecessorEvent;
                default:
                    return null;
            }
        });
    }

    it("should link to predecessor room", async () => {
        mockStateEvents(room);
        const tab = renderTab();
        const link = await tab.findByText("View older messages in test room.");
        fireEvent.click(link);
        expect(dis.dispatch).toHaveBeenCalledWith({
            action: Action.ViewRoom,
            event_id: "tombstone_event_id",
            room_id: "old_room_id",
            metricsTrigger: "WebPredecessorSettings",
            metricsViaKeyboard: false,
        });
    });

    describe("When MSC3946 support is enabled", () => {
        beforeEach(() => {
            jest.spyOn(SettingsStore, "getValue")
                .mockReset()
                .mockImplementation((settingName) => settingName === "feature_dynamic_room_predecessors");
        });

        it("should link to predecessor room via MSC3946 if enabled", async () => {
            mockStateEvents(room);
            const tab = renderTab();
            const link = await tab.findByText("View older messages in test room.");
            fireEvent.click(link);
            expect(dis.dispatch).toHaveBeenCalledWith({
                action: Action.ViewRoom,
                event_id: null,
                room_id: "old_room_id_via_predecessor",
                metricsTrigger: "WebPredecessorSettings",
                metricsViaKeyboard: false,
            });
        });
    });
});
