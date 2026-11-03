export type Notice={optional_admin_reason?:boolean;payment_id?:string;payment_version?:number;can_confirm?:boolean;confirm_as_admin?:boolean;id:string;category:string;kind:string;title:string;message:string;href:string;created_at:string;read_at:string|null};
export type Preferences={payments:boolean;expenses:boolean;groups:boolean;reminders:boolean;automatic:boolean;frequency:7|14};
export type Inbox={unread:number;items:Notice[];preferences:Preferences};
