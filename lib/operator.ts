import {env} from 'cloudflare:workers';
import {getChatGPTUser,chatGPTSignInPath} from '@/app/chatgpt-auth';
import {redirect} from 'next/navigation';
export async function getOperator(){const u=await getChatGPTUser();return u&&env.PRESIDIO_OWNER_EMAIL&&u.email.toLowerCase()===env.PRESIDIO_OWNER_EMAIL.toLowerCase()?u:null}
export async function requireOperator(){const u=await getChatGPTUser();if(!u)redirect(chatGPTSignInPath('/'));return await getOperator()}
