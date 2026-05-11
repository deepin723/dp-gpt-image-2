import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import './style.css'
import App from './App.vue'

const app = createApp(App)

if (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
  app.use(clerkPlugin, { publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY })
}

app.mount('#app')
