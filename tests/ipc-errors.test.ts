import { describe, expect, it } from 'vitest'
import { AppError } from '../src/shared/ipc/errors'
import { isDomainKey, issueKey, toErrorEnvelope } from '../src/shared/ipc/envelope'

describe('конверт ошибки (design D8, спека localization: сообщения при сохранении)', () => {
  it('AppError даёт конверт с ключом каталога и параметрами', () => {
    const envelope = toErrorEnvelope(new AppError('errors.strainNotFound', { strainId: 'x1' }))
    expect(envelope).toEqual({
      code: 'DOMAIN',
      message: 'errors.strainNotFound',
      key: 'errors.strainNotFound',
      params: { strainId: 'x1' }
    })
  })

  it('обычная ошибка остаётся INTERNAL без ключа каталога', () => {
    const envelope = toErrorEnvelope(new Error('sqlite is sad'))
    expect(envelope.code).toBe('INTERNAL')
    expect(envelope.message).toBe('sqlite is sad')
    expect(envelope.key).toBeUndefined()
  })

  it('issue без доменного сообщения — без ключа; с ключом errors.* — с ключом', () => {
    expect(issueKey('Expected number, received string')).toBeUndefined()
    expect(issueKey('errors.gravityRange')).toBe('errors.gravityRange')
    expect(isDomainKey('errors.batchArchived')).toBe(true)
    expect(isDomainKey('Произвольная фраза')).toBe(false)
    expect(isDomainKey('errors-errors')).toBe(false)
  })
})
