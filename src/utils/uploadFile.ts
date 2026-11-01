import type { AgoNativeFile, AgoUploadFile } from "../client/types";

/** A URI-based React Native file rather than a browser `File`/`Blob`. */
export function isNativeFile(file: AgoUploadFile): file is AgoNativeFile {
  return (
    typeof (file as AgoNativeFile).uri === "string" &&
    !(typeof Blob !== "undefined" && file instanceof Blob)
  );
}

/**
 * Append a file to a multipart body. A browser `File` goes in with its name; a
 * native `{ uri, name, type }` object is appended as-is, which is the shape
 * React Native's `FormData` reads to stream the file from disk.
 */
export function appendFile(
  formData: FormData,
  key: string,
  file: AgoUploadFile,
): void {
  if (isNativeFile(file)) {
    formData.append(key, file as unknown as Blob);
  } else {
    formData.append(key, file, file.name);
  }
}
