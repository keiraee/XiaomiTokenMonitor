<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import LoginPage from './pages/LoginPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import { getStatus } from './api.js';

const payload = ref({ auth: {} });
const booting = ref(true);
let timer = null;

const loggedIn = computed(() => Boolean(payload.value.auth?.loggedIn));

async function loadStatus() {
  payload.value = await getStatus();
}

function onLoggedIn() {
  loadStatus();
}

function onLoggedOut() {
  payload.value = { auth: { loggedIn: false, state: 'unauthenticated' } };
}

onMounted(async () => {
  try {
    await loadStatus();
  } finally {
    booting.value = false;
  }
  timer = setInterval(loadStatus, 30000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div v-if="booting" class="login-shell">
    <div class="login-brand">
      <p class="eyebrow">Local Service</p>
      <h1>Token Monitor</h1>
      <p class="login-brand-sub">加载中</p>
    </div>
  </div>
  <LoginPage v-else-if="!loggedIn" @success="onLoggedIn" />
  <DashboardPage
    v-else
    :auth="payload.auth"
    :cached-usage="payload.usage"
    @logged-out="onLoggedOut"
    @status="loadStatus"
  />
</template>
