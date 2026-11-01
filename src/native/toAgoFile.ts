import type { AgoNativeFile } from "../client/types";

/**
 * The fields Expo pickers return for a picked file. Covers `expo-document-picker`
 * (`name`, `size`) and `expo-image-picker` (`fileName`, `fileSize`).
 */
export interface PickedAsset {
  uri: string;
  name?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  fileSize?: number | null;
}

/**
 * Turn a picker asset into the `{ uri, name, type }` file `sendMessage`
 * uploads. Falls back to the URI's last segment for the name and to
 * `application/octet-stream` for the type.
 *
 * ```ts
 * const result = await DocumentPicker.getDocumentAsync();
 * if (!result.canceled) await sendMessage("Here is the file", result.assets.map(toAgoFile));
 * ```
 */
export function toAgoFile(asset: PickedAsset): AgoNativeFile {
  const name =
    asset.name || asset.fileName || asset.uri.split("/").pop() || "file";
  const size = asset.size ?? asset.fileSize ?? undefined;
  return {
    uri: asset.uri,
    name,
    type: asset.mimeType || "application/octet-stream",
    ...(size != null ? { size } : {}),
  };
}
