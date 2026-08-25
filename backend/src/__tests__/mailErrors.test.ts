import { describe, expect, it } from 'vitest'
import { localizeSmtpError } from '../lib/mailSend.js'

describe('localizeSmtpError', () => {
  it.each([
    ['EAUTH', 'Неверный логин или пароль для SMTP'],
    ['ETIMEDOUT', 'SMTP-сервер не отвечает - проверьте адрес, порт и шифрование'],
    ['ESOCKET', 'SMTP-сервер не отвечает - проверьте адрес, порт и шифрование'],
    ['ECONNECTION', 'Не удалось подключиться к SMTP-серверу - проверьте адрес и порт'],
    ['EDNS', 'SMTP-сервер не найден - проверьте адрес'],
    ['EENVELOPE', 'Некорректный адрес отправителя или получателя'],
    ['EOUTBOUND', 'Адрес SMTP-сервера запрещён политикой безопасности'],
  ])('maps %s without leaking transport details', (code, expected) => {
    expect(localizeSmtpError({ code, message: 'raw transport failure' })).toBe(expected)
  })

  it('uses a localized fallback for unknown errors', () => {
    expect(localizeSmtpError(new Error('raw failure'))).not.toContain('raw failure')
  })
})
