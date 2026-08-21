export function HelpPage() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Как пользоваться Herold
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Почтовый клиент для внешних IMAP/SMTP-аккаунтов
        </p>
      </div>

      <p style={{ margin: '0 0 1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
        Herold — личный почтовый клиент платформы Hof: он подключается к
        вашим существующим внешним почтовым аккаунтам по IMAP/SMTP и
        показывает их в одном интерфейсе. Herold не хранит и не
        отправляет почту от своего имени — только читает и отправляет
        через ваши собственные аккаунты.
      </p>

      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Сервис ещё строится
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          Подключение почтовых аккаунтов и сама работа с почтой пока не
          реализованы — этот раздел справки заполнится по мере готовности.
        </p>
      </div>
    </div>
  )
}
