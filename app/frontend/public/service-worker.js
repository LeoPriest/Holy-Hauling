self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = 'Holy Hauling'
  const options = {
    body: data.body || 'New notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/jobs'))
})
