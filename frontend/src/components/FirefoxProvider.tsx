import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from './Toast';

type Status = {installed:boolean;linked:boolean;state:string;error?:string;healthy?:boolean;country?:string;
  exitIp?:string;refreshAvailable?:boolean;quota?:{remaining:string|null;limit:string|null;reset:string|null;unlimited:boolean|null}};
const errors:Record<string,string>={REAUTH_REQUIRED:'حساب نیاز به ورود دارد.',LOGIN_EXPIRED:'مهلت ورود تمام شده؛ دوباره شروع کنید.',
  INVALID_CALLBACK:'نشانی بازگشت با این تلاش ورود مطابقت ندارد. نشانی کامل صفحهٔ موفقیت Mozilla را وارد کنید.',
  LOGIN_EXCHANGE_FAILED:'ورود مستقل پذیرفته نشد؛ کد تازه بگیرید. این اتصال آزمایشی و غیررسمی است.',
  ACCOUNT_NOT_ELIGIBLE:'حساب فعلاً مجاز به استفاده از این سرویس نیست.',QUOTA_EXHAUSTED:'سهمیهٔ حساب تمام شده است.',
  REGION_UNAVAILABLE:'کشور انتخابی در دسترس نیست.',FIREFOX_NOT_INSTALLED:'ابتدا سرور را آپدیت کنید.',
  DISCONNECT_ACCOUNT_FIRST:'ابتدا حساب فعلی را قطع کنید.',BUSY:'عملیات قبلی در حال انجام است.'};
function bytes(value?:string|null) {return value==null?'نامشخص':`${(Number(value)/1024**3).toFixed(2)} GB`;}
export default function FirefoxProvider(){
  const qc=useQueryClient(),toast=useToast();const [callback,setCallback]=useState(''),[login,setLogin]=useState<{url:string;expiresAt:string}|null>(null);
  const status=useQuery({queryKey:['firefox-status'],queryFn:()=>api<Status>('/api/firefox/status'),refetchInterval:15000});
  const countries=useQuery({queryKey:['firefox-locations'],queryFn:()=>api<{locations:{code:string;name:string}[]}>('/api/firefox/locations'),enabled:status.data?.installed===true,staleTime:3600000});
  const action=useMutation({mutationFn:({op,body={}}:{op:string;body?:object})=>api<Status & {url?:string;expiresAt?:string}>('/api/firefox/'+op,{method:'POST',body:JSON.stringify(body)}),
    onSuccess:(result,vars)=>{
      if(result.url && result.expiresAt)setLogin({url:result.url,expiresAt:result.expiresAt});
      if(vars.op==='complete'||vars.op==='logout'){setLogin(null);setCallback('');}
      qc.invalidateQueries({queryKey:['firefox-status']});qc.invalidateQueries({queryKey:['warp-status']});qc.invalidateQueries({queryKey:['settings']});
      if(result.error)toast(errors[result.error] || result.error,'error');
      else if(vars.op!=='start')toast(vars.op==='logout'?'حساب محلی قطع شد؛ مجوز حساب را در Mozilla هم می‌توانید لغو کنید.':'عملیات انجام شد. وضعیت اتصال را بررسی کنید.','success');
    },onError:(e:Error)=>toast(errors[e.message]||e.message,'error')});
  const s=status.data;
  return <div className="rounded-xl border border-[var(--line)] p-4 space-y-4">
    <div><h4 className="font-bold">Firefox VPN · آزمایشی</h4><p className="text-xs text-muted mt-2">خروجی سوم برای همین سایت‌ها و کاربران انتخاب‌شده؛ نیازمند حساب Mozilla مدیر است. سهمیهٔ حساب بین ترافیک کاربران مشمول مشترک است. این اتصال مستقل، رسمیِ Mozilla نیست.</p></div>
    {status.isLoading?<p className="text-muted text-sm">در حال دریافت وضعیت حساب و سرویس…</p>:status.isError||s?.state==='UNAVAILABLE'?<p className="text-amber-400 text-sm">دریافت وضعیت فعلاً ناموفق است؛ چند لحظه بعد دوباره بررسی می‌شود.</p>:!s?.installed?<p className="text-amber-400 text-sm">سرویس نصب نشده؛ ابتدا اسکریپت آپدیت سرور را اجرا کنید.</p>:<>
      <p className="text-sm">حساب: {s.linked?'متصل':'نیاز به ورود'} · تونل: {s.healthy?'آزمایش موفق':s.state==='READY'?'آمادهٔ آزمایش':'تأیید نشده'} {s.exitIp&&<span dir="ltr"> · {s.exitIp}</span>}</p>
      {s.error&&<p className="text-amber-400 text-sm">{errors[s.error]||s.error}</p>}
      {s.linked?<>
        <div className="grid sm:grid-cols-3 gap-3 text-xs text-muted"><span>باقیمانده: {s.quota?.unlimited===true?'نامحدود':bytes(s.quota?.remaining)}</span><span>سقف حساب: {bytes(s.quota?.limit)}</span><span>تمدید سهمیه: {s.quota?.reset?new Date(s.quota.reset).toLocaleString('fa-IR'):'نامشخص'}</span></div>
        {!s.refreshAvailable&&<p className="text-xs text-amber-400">حساب توکن تمدید ندارد؛ پس از پایان اعتبار، ورود مجدد لازم می‌شود.</p>}
        <label className="block text-sm">کشور خروجی<select className="input block mt-2" value={s.country||'REC'} disabled={action.isPending||!countries.data} onChange={e=>action.mutate({op:'country',body:{country:e.target.value}})}><option value="REC">خودکار</option>{countries.data?.locations.map(c=><option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select></label>
        <div className="flex flex-wrap gap-3"><button className="btn-ghost" disabled={action.isPending} onClick={()=>action.mutate({op:'check'})}>آزمایش اتصال و سهمیه</button><button className="btn-ghost" disabled={action.isPending||!s.refreshAvailable} onClick={()=>action.mutate({op:'renew'})}>آزمایش تمدید اعتبار</button><button className="btn-ghost text-rose-300" disabled={action.isPending} onClick={()=>action.mutate({op:'logout'})}>قطع حساب و توقف مسیر Firefox</button></div>
      </>:<>
        <button className="btn-ghost" disabled={action.isPending} onClick={()=>action.mutate({op:'start'})}>شروع ورود با Mozilla</button>
        {login&&<div className="space-y-3"><a href={login.url} target="_blank" rel="noreferrer" className="btn-primary">بازکردن صفحهٔ رسمی ورود</a><p className="text-xs text-muted">پس از ورود و تأیید، نشانی کامل صفحهٔ موفقیت Mozilla را اینجا وارد کنید. رمز را اینجا ننویسید. نشانی را در چت یا جای عمومی نفرستید. مهلت: {new Date(login.expiresAt).toLocaleTimeString('fa-IR')}</p>
          <input type="password" autoComplete="off" className="input w-full" dir="ltr" value={callback} onChange={e=>setCallback(e.target.value)} placeholder="https://accounts.firefox.com/oauth/success/…?code=…&state=…"/>
          <button className="btn-primary" disabled={action.isPending||!callback} onClick={()=>action.mutate({op:'complete',body:{callback}})}>اتصال حساب و فعال‌سازی Firefox VPN</button></div>}
      </>}
      <p className="text-xs text-muted">پس از آزمایش موفق، Firefox را به‌عنوان خروجی انتخاب و تنظیمات را ذخیره کنید. انتخاب کشور یا قطع حساب، اتصال‌های فعال همین خروجی را می‌بندد. پشتیبانی این نسخه TCP است؛ UDP از این خروجی عبور نمی‌کند.</p>
    </>}
  </div>;
}
