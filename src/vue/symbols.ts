import type { InjectionKey } from "vue";
import type { AgoClient } from "../client/AgoClient";

export const AGO_CLIENT_KEY: InjectionKey<AgoClient> = Symbol("ago-client");
