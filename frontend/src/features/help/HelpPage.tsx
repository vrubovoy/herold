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

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Подключение аккаунта
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          На странице «Аккаунты» нажмите «Подключить аккаунт» и укажите
          параметры сервера IMAP (для получения почты) и SMTP (для
          отправки) — обычно их можно найти в настройках самого
          почтового сервиса. Кнопка «Проверить соединение» покажет,
          верны ли данные, ещё до сохранения. Если сервер SMTP совпадает
          с IMAP, отдельно вводить его не нужно.
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Просмотр почты
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          Раздел «Почта» показывает папки подключённого аккаунта и
          письма в них. Новые письма подтягиваются автоматически на
          фоне — раз в несколько минут, без необходимости обновлять
          страницу. Вложения не хранятся в Herold: они скачиваются
          напрямую с почтового сервера в момент, когда вы открываете
          письмо или нажимаете на вложение.
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Сервис ещё строится
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          Пока можно подключать аккаунты и читать почту. Написание и
          отправка писем появятся в одном из следующих обновлений.
        </p>
      </div>
    </div>
  )
}
