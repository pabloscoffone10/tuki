import { NotificationList } from "@/features/notifications/components";
export const metadata={title:"Notificaciones"};
export default function Page(){return <div className="mx-auto max-w-3xl space-y-6"><h1 className="text-3xl font-semibold">Notificaciones</h1><p className="text-sm text-muted-foreground">Últimos 100 avisos. Las solicitudes de confirmación también permanecen en Pagos.</p><NotificationList/></div>;}
