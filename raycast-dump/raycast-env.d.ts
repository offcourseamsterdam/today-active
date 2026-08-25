/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** App URL - Your Vandaag app URL */
  "apiUrl": string,
  /** Write Away Secret - Your WRITE_AWAY_SECRET from the Write Away tab in Vandaag */
  "secret": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `dump` command */
  export type Dump = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `dump` command */
  export type Dump = {}
}

