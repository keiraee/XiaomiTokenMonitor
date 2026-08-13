<script setup>
import { computed } from 'vue';

const props = defineProps({
  usage: { type: Object, default: null },
  fallback: { type: Object, default: null },
  error: { type: String, default: '' },
  formatTime: { type: Function, required: true },
});
defineEmits(['refresh']);

const summary = computed(() => props.usage?.summary || props.fallback);
const percent = computed(() => summary.value?.percentText || '—');
const barWidth = computed(() => {
  const p = Number(summary.value?.percent || 0);
  return `${Math.min(Math.max(p * 100, 0), 100)}%`;
});
const credits = computed(() => {
  if (!summary.value) return '已用 — / 总计 — Credits';
  return `已用 ${summary.value.usedCredits.toFixed(2)} / 总计 ${summary.value.totalCredits.toFixed(2)} Credits`;
});
</script>

<template>
  <section class="panel panel-feature">
    <div class="panel-head">
      <p class="eyebrow">Usage</p>
      <h2>用量概览</h2>
    </div>
    <div class="metric-display">
      <span class="metric-value">{{ percent }}</span>
      <span class="metric-unit">已用比例</span>
    </div>
    <div class="progress-track" role="progressbar">
      <span class="progress-fill" :style="{ width: barWidth }"></span>
    </div>
    <p class="metric-caption">{{ credits }}</p>
    <dl v-if="summary" class="spec-list">
      <dt>剩余额度</dt>
      <dd>{{ Number(summary.remainingCredits || 0).toFixed(2) }} Credits</dd>
      <dt>更新时间</dt>
      <dd>{{ formatTime(usage?.fetchedAt) }}</dd>
    </dl>
    <div class="actions">
      <button class="btn btn-primary" type="button" @click="$emit('refresh')">刷新用量</button>
    </div>
    <div v-if="error" class="notice error">{{ error }}</div>
  </section>
</template>
