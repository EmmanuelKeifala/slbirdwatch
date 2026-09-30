import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

/** Resize so the long edge is at most `maxEdge` (never upscales) and save as JPEG. NFR-04. */
export async function shrink(asset: ImagePickerAsset, maxEdge: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > maxEdge) {
    ctx.resize(asset.width >= asset.height ? { width: maxEdge } : { height: maxEdge });
  }
  const ref = await ctx.renderAsync();
  return (await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
}
