import { getLogger } from '@logtape/logtape'

export const logger = getLogger(['fedisky'])
export const apLogger = getLogger(['fedisky', 'federation'])
