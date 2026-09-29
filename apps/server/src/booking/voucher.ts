/**
 * 模拟预订凭证（FR-AGT-08）
 *
 * 演示口径：用户确认行程后「生成」一张标注「演示模拟」的凭证。
 * 这里**不接任何真实预订 / 支付通道**，凭证只是把已确认的行程转成可核验的单据形态：
 * 凭证号（可复述、可再查）、条目化的预订清单、金额合计。
 *
 * 凭证号 `YJZY-YYYYMMDD-NNNN` 按日发号并落库续号：
 * 演示期间不重号，服务重启也不会把号打回 0001。
 *
 * 此前这个接口是**空转**的——固定返回模板里的 example，不收参数、不发号，前端也从不调用，
 * 整条链是死代码。现在按行程真实生成，并把每次发出的凭证登记进 booking_vouchers。
 */
import type { DemoPlan } from "@zhiyou/shared";
import { getItinerary, insertVoucher, loadJson, nextVoucherSeq } from "../db/db.ts";
import { CLASSIC_PLAN } from "../itinerary/plan.ts";

/** 模板文件：meta/footer/qr 文案沿用素材，避免两处维护同一套免责声明 */
interface VoucherTemplateFile {
  meta?: { name?: string; disclaimer?: string };
  template?: { qr_code_text?: string; footer?: string; demo_label?: string };
}

let tplCache: VoucherTemplateFile | null = null;
function tpl(): VoucherTemplateFile {
  if (!tplCache) tplCache = loadJson<VoucherTemplateFile>("booking_voucher_template.json");
  return tplCache;
}

export interface VoucherBooking {
  type: "hotel" | "restaurant" | "experience";
  name: string;
  poi_id: string;
  guests: number;
  price_cny: number;
  /** hotel 专用 */
  check_in?: string;
  check_out?: string;
  /** restaurant / experience 专用 */
  date?: string;
  time?: string;
  indoor?: boolean;
  note?: string;
}

export interface VoucherDoc {
  voucher_no: string;
  status: string;
  is_demo: true;
  demo_label: string;
  created_at: string;
  session_id: string;
  itinerary: {
    id: string;
    title: string;
    days: number;
    total_budget_cny: number;
    sources: string[];
  };
  bookings: VoucherBooking[];
  payment: { method: string; total_cny: number; status: string };
  qr_code_text: string;
  footer: string;
  disclaimer: string;
}

export interface IssueVoucherInput {
  sessionId?: string;
  /** 指定已落库的行程 */
  itineraryId?: string;
  /** 或直接把行程传进来（对话链路里手上已有一份，不必再查库） */
  itinerary?: (DemoPlan & { id?: string }) | null;
  guests?: number;
  /** 行程首日 YYYY-MM-DD；不传按今天算。决定入住/用餐日期 */
  startDate?: string;
}

/* ---------- 日期（一律走本地时区：凭证是给人看的，不该按 UTC 跨日） ---------- */

const pad = (n: number) => String(n).padStart(2, "0");

function localToday(d = new Date()) {
  return {
    /** YYYYMMDD，用于凭证号与发号分区 */
    ymd: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
    /** YYYY-MM-DD，用于单据日期 */
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- 行程条目 → 预订清单 ---------- */

/**
 * 只把**有花费**的条目转成单据：免费景点不产生预订，
 * 硬塞进去会让凭证变成一张行程复读机，反而看不出"订了什么、花了多少"。
 */
const TYPE_RULES: Array<{ type: VoucherBooking["type"]; re: RegExp }> = [
  { type: "hotel", re: /客栈|民宿|酒店|宾馆|度假村|山庄/ },
  { type: "restaurant", re: /餐|烤全羊|麦饼|素面|粉干|金粉饺|小吃|茶|咖啡|食/ },
];

function classify(name: string): VoucherBooking["type"] {
  for (const r of TYPE_RULES) if (r.re.test(name)) return r.type;
  return "experience";
}

/** 优先用手上的行程，其次按 id 查库，最后退回经典两日线（宁可给兜底，不可让接口挂掉） */
function resolvePlan(input: IssueVoucherInput): DemoPlan & { id?: string } {
  if (input.itinerary && Array.isArray(input.itinerary.days)) return input.itinerary;
  if (input.itineraryId) {
    const found = getItinerary(input.itineraryId) as (DemoPlan & { id?: string }) | null;
    if (found) return found;
  }
  return CLASSIC_PLAN;
}

/* ---------- 发凭证 ---------- */

export function issueVoucher(input: IssueVoucherInput = {}): VoucherDoc {
  const plan = resolvePlan(input);
  const guests = Math.max(1, Math.floor(Number(input.guests ?? 2)));

  const { ymd, date: today } = localToday();
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate ?? ""))
    ? String(input.startDate)
    : today;

  const seq = nextVoucherSeq(ymd);
  const voucherNo = `YJZY-${ymd}-${String(seq).padStart(4, "0")}`;

  const bookings: VoucherBooking[] = [];
  plan.days.forEach((day, di) => {
    const dayDate = addDays(startDate, di);
    day.items.forEach((it) => {
      if (!it.cost_cny) return;
      const type = classify(it.name);
      const base: VoucherBooking = {
        type,
        name: it.name,
        poi_id: it.id,
        guests,
        price_cny: it.cost_cny,
        indoor: it.indoor,
        note: it.reason,
      };
      if (type === "hotel") {
        // 住宿条目跨夜：入住当天，退房次日
        bookings.push({ ...base, check_in: dayDate, check_out: addDays(startDate, di + 1) });
      } else {
        bookings.push({ ...base, date: dayDate, time: it.start });
      }
    });
  });

  const total = bookings.reduce((s, b) => s + b.price_cny, 0);
  const t = tpl();

  const doc: VoucherDoc = {
    voucher_no: voucherNo,
    status: "模拟已确认",
    is_demo: true,
    demo_label: t.template?.demo_label ?? "演示模拟 · DEMO",
    created_at: new Date().toISOString(),
    session_id: input.sessionId ?? "",
    itinerary: {
      id: plan.id ?? "",
      title: plan.title,
      days: plan.days.length,
      total_budget_cny: plan.budget_total_cny ?? total,
      sources: plan.sources ?? [],
    },
    bookings,
    payment: { method: "演示支付（未实际扣款）", total_cny: total, status: "模拟支付成功" },
    qr_code_text: (t.template?.qr_code_text ?? "永嘉新游演示凭证 - {voucher_no}").replace(
      "{voucher_no}",
      voucherNo,
    ),
    footer: t.template?.footer ?? "本凭证由永嘉新游AI伴游平台生成，仅供大赛演示使用。",
    disclaimer: t.meta?.disclaimer ?? "本凭证为大赛演示模拟数据，不构成真实预订，不产生实际费用。",
  };

  insertVoucher(
    {
      voucher_no: voucherNo,
      issue_date: ymd,
      seq,
      session_id: doc.session_id,
      itinerary_id: doc.itinerary.id,
      title: plan.title,
      total_cny: total,
      guests,
      status: "confirmed",
      created_at: doc.created_at,
    },
    doc,
  );

  return doc;
}
