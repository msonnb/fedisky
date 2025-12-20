import type { Activity, Object as APObject, Context } from '@fedify/fedify'
import { LocalViewer } from '../../read-after-write/viewer'

type APConversionResult = {
  object: APObject
  activity?: Activity
}

export interface RecordConverter<T = unknown> {
  collection: string

  toActivityPub(
    ctx: Context<void>,
    identifier: string,
    record: { uri: string; cid: string; value: T },
    localViewer: LocalViewer,
  ): Promise<APConversionResult | null>

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
