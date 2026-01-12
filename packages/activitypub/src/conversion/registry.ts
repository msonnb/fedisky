import type { Activity, Object as APObject, Context } from '@fedify/fedify'
import { BlobRef } from '@atproto/api'
import { PDSClient } from '../pds-client'

export type BlobUploader = (
  data: Uint8Array,
  mimeType: string,
) => Promise<BlobRef>

export interface ToRecordContext {
  pdsClient?: PDSClient
  uploadBlob?: BlobUploader
}

export interface RecordConverter<
  T = unknown,
  TObject extends APObject = APObject,
> {
  collection: string

  toActivityPub(
    ctx: Context<void>,
    identifier: string,
    record: { uri: string; cid: string; value: T },
    pdsClient: PDSClient,
  ): Promise<{ object: TObject; activity?: Activity } | null>

  toRecord(
    ctx: Context<void>,
    identifier: string,
    object: TObject,
    options?: ToRecordContext,
  ): Promise<{ uri: string; cid: string; value: T } | null>

  objectTypes?: Array<typeof APObject>
}

export class RecordConverterRegistry {
  private converters = new Map<string, RecordConverter>()

  register(converter: RecordConverter): void {
    this.converters.set(converter.collection, converter)
  }

  get(collection: string): RecordConverter | undefined {
    return this.converters.get(collection)
  }

  getAll(): RecordConverter[] {
    return Array.from(this.converters.values())
  }
}
