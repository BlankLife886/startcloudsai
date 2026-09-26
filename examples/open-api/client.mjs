// Node.js 22+. Keep this client on your server, never in a public browser bundle.
export class StarCloudClient {
  constructor({baseURL,apiKey}) {
    this.baseURL=baseURL.replace(/\/$/,'');this.apiKey=apiKey;
    const url=new URL(this.baseURL);
    if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw new Error('HTTPS required');
  }
  async request(path,{method='GET',body,signal}={}) {
    const response=await fetch(this.baseURL+path,{method,signal:signal||AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${this.apiKey}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const result=await response.json();
    if(!response.ok||!result.success){const error=new Error(result.error||`HTTP ${response.status}`);error.code=result.code;error.status=response.status;throw error}
    return result.data;
  }
  models(){return this.request('/models')}
  usage(){return this.request('/usage')}
  quote(input){return this.request('/tasks/quote',{method:'POST',body:input})}
  // Persist idempotencyKey in your own order record before sending the first request.
  createTask(input,idempotencyKey){if(!idempotencyKey)throw new Error('idempotencyKey required');return this.request('/tasks',{method:'POST',body:{...input,idempotencyKey}})}
  async waitForTask(id,{signal,timeoutMs=15*60*1000}={}) {
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      signal?.throwIfAborted();
      const task=await this.request('/tasks/'+encodeURIComponent(id),{signal});
      if(['succeeded','failed','canceled'].includes(task.status))return task;
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new Error('Aborted'))};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},2000);
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });
    }
    throw new Error(`Task ${id} is still running; keep its ID and query later`);
  }
}
