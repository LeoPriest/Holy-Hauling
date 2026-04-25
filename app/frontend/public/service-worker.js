self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Holy Hauling'
  const options = {
    body: data.body || 'New notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { path: data.path || '/jobs' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = event.notification.data?.path || '/jobs'
  event.waitUntil(clients.openWindow(path))
})
