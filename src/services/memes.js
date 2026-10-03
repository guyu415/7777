const BASE='https://chat.xiaoman.xyz'
export async function memeRequest(path='',options={}){
 const password=localStorage.getItem('auth.password')
 if(!password)throw new Error('请先登录小手机。')
 const response=await fetch(BASE+'/memes/'+path,{...options,headers:{'X-Eunoia-Password':password,...options.headers}})
 const data=await response.json()
 if(!response.ok)throw new Error(data.error||'操作失败，请重试。')
 return data
}
export async function memeImage(id,signal){
 const response=await fetch(BASE+'/memes/image/'+id,{headers:{'X-Eunoia-Password':localStorage.getItem('auth.password')||''},signal})
 if(!response.ok)throw new Error('图片暂时无法加载。')
 return URL.createObjectURL(await response.blob())
}
