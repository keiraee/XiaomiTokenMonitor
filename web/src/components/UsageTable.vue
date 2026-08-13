<script setup>
defineProps({
  items: { type: Array, default: () => [] },
});
</script>

<template>
  <section v-if="items.length" class="panel panel-wide">
    <div class="panel-head">
      <p class="eyebrow">明细</p>
      <h2>详细用量</h2>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>已用</th>
            <th>总量</th>
            <th>剩余</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.name">
            <td>{{ item.name }}</td>
            <td>{{ item.usedCredits.toFixed(2) }}</td>
            <td>{{ item.limitCredits.toFixed(2) }}</td>
            <td>{{ (item.remaining / 1e8).toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
