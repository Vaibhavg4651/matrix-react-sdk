/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import { MatrixEvent } from "matrix-js-sdk/src/models/event";
import { EventType } from "matrix-js-sdk/src/@types/event";

import { GenericEchoChamber, implicitlyReverted, PROPERTY_UPDATED } from "./GenericEchoChamber";
import { getRoomNotifsState, RoomNotifState, setRoomNotifsState } from "../../RoomNotifs";
import { RoomEchoContext } from "./RoomEchoContext";
import { _t } from "../../languageHandler";

export enum CachedRoomKey {
    NotificationVolume,
}

export class RoomEchoChamber extends GenericEchoChamber<RoomEchoContext, CachedRoomKey, RoomNotifState> {
    private properties = new Map<CachedRoomKey, RoomNotifState>();

    public constructor(context: RoomEchoContext) {
        super(context, (k) => this.properties.get(k));
    }

    protected onClientChanged(oldClient, newClient): void {
        this.properties.clear();
        if (oldClient) {
            oldClient.removeListener("accountData", this.onAccountData);
        }
        if (newClient) {
            // Register the listeners first
            newClient.on("accountData", this.onAccountData);

            // Then populate the properties map
            this.updateNotificationVolume();
        }
    }

    private onAccountData = (event: MatrixEvent): void => {
        if (event.getType() === EventType.PushRules) {
            const currentVolume = this.properties.get(CachedRoomKey.NotificationVolume);
            const newVolume = getRoomNotifsState(this.matrixClient, this.context.room.roomId);
            if (currentVolume !== newVolume) {
                this.updateNotificationVolume();
            }
        }
    };

    private updateNotificationVolume(): void {
        const state = getRoomNotifsState(this.matrixClient, this.context.room.roomId);
        if (state) this.properties.set(CachedRoomKey.NotificationVolume, state);
        else this.properties.delete(CachedRoomKey.NotificationVolume);
        this.markEchoReceived(CachedRoomKey.NotificationVolume);
        this.emit(PROPERTY_UPDATED, CachedRoomKey.NotificationVolume);
    }

    // ---- helpers below here ----

    public get notificationVolume(): RoomNotifState {
        return this.getValue(CachedRoomKey.NotificationVolume);
    }

    public set notificationVolume(v: RoomNotifState) {
        this.setValue(
            _t("Change notification settings"),
            CachedRoomKey.NotificationVolume,
            v,
            async (): Promise<void> => {
                return setRoomNotifsState(this.context.room.roomId, v);
            },
            implicitlyReverted,
        );
    }
}
