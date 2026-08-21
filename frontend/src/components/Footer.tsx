import { Footer as SharedFooter } from '@zudar107/schloss-ui'

export function Footer() {
  return <SharedFooter serviceName="Herold" description="Почтовый клиент для внешних IMAP/SMTP-аккаунтов" version={__APP_VERSION__} helpHref="/help" />
}
