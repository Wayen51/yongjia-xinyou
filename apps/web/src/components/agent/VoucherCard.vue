<script setup lang="ts">
/**
 * 模拟预订凭证卡片（FR-AGT-08）
 *
 * 演示口径：这张凭证是**模拟**的 —— 不接真实预订 / 支付通道，
 * 只是把已确认的行程转成可核验的单据形态：凭证号、预订清单、金额合计。
 * 卡片顶部/底部两处明示「演示模拟」，不做成看起来能扫的二维码，
 * 只给可复述的核验串，避免被误读成真实订单。
 */
import type { BookingVoucher } from "@/types/api";

defineProps<{ voucher: BookingVoucher }>();

const TYPE_LABEL: Record<string, string> = {
  hotel: "住宿",
  restaurant: "餐饮",
  experience: "体验",
};
</script>

<template>
  <div class="vc">
    <header class="vc__head">
      <div class="vc__headleft">
        <div class="vc__label">模拟预订凭证</div>
        <div class="vc__no">{{ voucher.voucher_no }}</div>
      </div>
      <span class="vc__demo">{{ voucher.demo_label }}</span>
    </header>

    <div class="vc__status">
      <span class="vc__dot" />
      {{ voucher.status }}
    </div>

    <div class="vc__itinerary">
      <b>{{ voucher.itinerary.title }}</b>
      <span>{{ voucher.itinerary.days }} 天 · 预算参考 ¥{{ voucher.itinerary.total_budget_cny }}</span>
    </div>

    <ul v-if="voucher.bookings.length" class="vc__list">
      <li v-for="(b, i) in voucher.bookings" :key="`${b.poi_id}-${i}`" class="vc__item">
        <span class="vc__type">{{ TYPE_LABEL[b.type] || b.type }}</span>
        <div class="vc__body">
          <div class="vc__name">{{ b.name }}</div>
          <div class="vc__meta">
            <template v-if="b.type === 'hotel'">
              {{ b.check_in }} 入住 · {{ b.check_out }} 退房 · {{ b.guests }} 人
            </template>
            <template v-else>{{ b.date }} {{ b.time }} · {{ b.guests }} 人</template>
          </div>
        </div>
        <span class="vc__price">¥{{ b.price_cny }}</span>
      </li>
    </ul>
    <p v-else class="vc__empty">
      这份行程没有产生需要预订的付费条目（景点多为免费），凭证仍可作为行程确认单留存。
    </p>

    <div class="vc__pay">
      <span>{{ voucher.payment.method }}</span>
      <b>合计 ¥{{ voucher.payment.total_cny }}</b>
    </div>

    <div class="vc__verify">
      <span class="vc__verify-label">核验串（演示）</span>
      <code class="vc__verify-text">{{ voucher.qr_code_text }}</code>
    </div>

    <footer class="vc__foot">{{ voucher.disclaimer }}</footer>
  </div>
</template>

<style scoped>
.vc {
  border: 1px solid var(--border, rgba(62, 198, 184, 0.22));
  border-radius: 14px;
  padding: 14px 16px;
  background: linear-gradient(180deg, rgba(62, 198, 184, 0.07), transparent 55%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vc__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.vc__label {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--text-dim, #6b7785);
}
.vc__no {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 17px;
  font-weight: 700;
  color: var(--primary, #3ec6b8);
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.vc__demo {
  flex: none;
  font-size: 10.5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px dashed rgba(233, 155, 63, 0.6);
  color: #e99b3f;
  white-space: nowrap;
}
.vc__status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary, #8895a3);
}
.vc__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary, #3ec6b8);
}
.vc__itinerary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.vc__itinerary b {
  font-size: 14px;
}
.vc__itinerary span {
  font-size: 11.5px;
  color: var(--text-dim, #6b7785);
}
.vc__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.vc__item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}
.vc__type {
  flex: none;
  margin-top: 1px;
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(62, 198, 184, 0.22));
  color: var(--text-secondary, #8895a3);
  white-space: nowrap;
}
.vc__body {
  min-width: 0;
  flex: 1;
}
.vc__name {
  font-size: 13px;
  line-height: 1.4;
}
.vc__meta {
  font-size: 11px;
  color: var(--text-dim, #6b7785);
  margin-top: 1px;
}
.vc__price {
  flex: none;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  color: var(--text-primary, #e8eef2);
}
.vc__empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim, #6b7785);
}
.vc__pay {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-top: 9px;
  border-top: 1px dashed var(--border, rgba(62, 198, 184, 0.22));
  font-size: 12px;
  color: var(--text-secondary, #8895a3);
}
.vc__pay b {
  font-size: 15px;
  color: var(--primary, #3ec6b8);
}
.vc__verify {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vc__verify-label {
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--text-dim, #6b7785);
}
.vc__verify-text {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.6;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px dashed var(--border, rgba(62, 198, 184, 0.22));
  color: var(--text-secondary, #8895a3);
  word-break: break-all;
}
.vc__foot {
  font-size: 10.5px;
  line-height: 1.7;
  color: var(--text-dim, #6b7785);
}
</style>
