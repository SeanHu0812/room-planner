"use client";

/** Downscale an uploaded image to a max edge and return a JPEG/PNG data URL + dimensions. */
export async function prepareFloorPlanImage(
  file: File,
  maxEdge = 2000
): Promise<{ dataUrl: string; width: number; height: number; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // JPEG keeps payloads small for the vision API; floor plans compress well.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { dataUrl, width, height, mediaType: "image/jpeg" };
}

export function dataUrlToBase64(dataUrl: string): { base64: string; mediaType: string } {
  const [head, base64] = dataUrl.split(",");
  const mediaType = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  return { base64, mediaType };
}
