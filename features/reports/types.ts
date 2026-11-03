import { z } from "zod";

const money=z.string().regex(/^-?\d+$/);
const count=z.number().int().nonnegative();
export const statisticsSchema=z.object({
 group_id:z.string().uuid(),group_name:z.string(),from:z.string().nullable(),to:z.string().nullable(),currency:z.literal("UYU"),
 expense_count:count,total_minor:money,confirmed_minor:money,outstanding_minor:money,pending_payment_count:count,
 people:z.array(z.object({person_id:z.string().uuid(),display_name:z.string(),advanced_minor:money,consumed_minor:money,settled_paid_minor:money,settled_received_minor:money,balance_minor:money})),
 currencies:z.array(z.object({currency:z.string(),original_minor:money,total_minor:money})),
 categories:z.array(z.object({category:z.string(),total_minor:money,count})),
 timeline:z.array(z.object({date:z.string(),total_minor:money,count})),
});
export type GroupStatistics= z.infer<typeof statisticsSchema>;
export const personalStatisticsSchema=z.object({
 person_id:z.string().uuid(),advanced_minor:money,consumed_minor:money,expense_count:count,
 owe_minor:money,owed_minor:money,confirmed_paid_minor:money,confirmed_received_minor:money,pending_payment_count:count,
 recent_groups:z.array(z.object({id:z.string().uuid(),name:z.string(),last_activity_at:z.string()})),
});
export type PersonalStatistics=z.infer<typeof personalStatisticsSchema>;
export type ReportSearch=Record<string,string|string[]|undefined>;
