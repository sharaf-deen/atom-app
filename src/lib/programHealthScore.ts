/** Advisory indicators only. Not a financial score or class-attendance measure. */
export type HealthSignals = {
  key:string
  joined_30:number
  joined_previous_30:number
  ended_30:number
  ended_previous_30:number
  expiring_7:number
  expiring_30:number
  renewal_members:{user_id:string;days_left:number;end_date:string}[]
}

export type ScoreInput = {
  enrolled:number
  active:number
  target_capacity:number|null
}
type Factor={name:string;score:number|null;weight:number;note:string}

const bounded=(v:number)=>Math.max(0,Math.min(100,Math.round(v)))
export function scoreProgram(input:ScoreInput,signal:HealthSignals|undefined) {
  const target=input.target_capacity
  const ratio=target&&target>0?input.active/target:null
  const capacity=ratio===null?null:bounded(ratio<=0.8?ratio*125:ratio<=1?100:100-(ratio-1)*200)
  const riskRatio=signal&&input.active>0?Math.min(1,signal.expiring_7/input.active):0
  const retention=input.enrolled>0?
    bounded((input.active/input.enrolled)*100-riskRatio*25):null
  const newCurrent=signal?signal.joined_30-signal.ended_30:0
  const newPrevious=signal?signal.joined_previous_30-signal.ended_previous_30:0
  const volume=signal?signal.joined_30+signal.ended_30+signal.joined_previous_30+signal.ended_previous_30:0
  const momentum=signal&&volume>0?
    bounded(50+50*(newCurrent-newPrevious)/Math.max(3,volume)):null
  const factors:Factor[]=[
    {name:'Active capacity',score:capacity,weight:30,note:'80–100% active target is optimal; overcrowding reduces score.'},
    {name:'Membership retention',score:retention,weight:40,note:'Active/enrolled ratio, with a small adjustment for renewals due in 7 days.'},
    {name:'Enrollment momentum',score:momentum,weight:30,note:'Net enrollment events over the last 30 days versus the previous 30 days.'},
    {name:'Per-class attendance',score:null,weight:0,note:'Unavailable: gym-wide scans do not identify the attended class and are not scored.'}
  ]
  const coverage=factors.reduce((sum,f)=>sum+(f.score===null?0:f.weight),0)
  const score=coverage>=60
    ?bounded(factors.reduce((sum,f)=>sum+(f.score===null?0:f.score*f.weight),0)/coverage)
    :null
  return {
    score,coverage,factors,
    level:score===null?'Insufficient data':score>=80?'Healthy':score>=60?'Watch':'Needs attention',
    trend:signal?newCurrent-newPrevious:null,
    trendNow:newCurrent,trendPrevious:newPrevious,
    expiring7:signal?.expiring_7??0,expiring30:signal?.expiring_30??0,
    lowSample:volume>0&&volume<5,
  }
}

export function priorityActions(
  input:ScoreInput, signal:HealthSignals|undefined,
  targetStatus:'not_set'|'empty'|'room'|'watch'|'full',
  unvisitedActive:number
):string[] {
  const actions:string[]=[]
  if(targetStatus==='not_set')actions.push('Set an active-member capacity target to enable occupancy scoring and alerts.')
  if(targetStatus==='full')actions.push('Review group density and whether a second class or group is appropriate.')
  else if(targetStatus==='watch')actions.push('Prepare additional group capacity if active registrations continue to increase.')
  if((signal?.expiring_7??0)>0)actions.push('Prioritize renewing '+signal!.expiring_7+' membership(s) expiring within seven days.')
  else if((signal?.expiring_30??0)>0)actions.push('Plan renewal follow-up for '+signal!.expiring_30+' membership(s) expiring within 30 days.')
  if(input.enrolled>input.active)actions.push('Review '+(input.enrolled-input.active)+' assigned member(s) without a currently active subscription.')
  if(unvisitedActive>0)actions.push('Review '+unvisitedActive+' active member(s) without a recorded gym-wide scan in 30 days; scan coverage may be incomplete.')
  if(signal && signal.joined_30<signal.joined_previous_30)actions.push('Investigate the decline in new enrollment events compared with the previous 30 days.')
  if(input.enrolled===0)actions.push('Review program positioning, schedule and prospect demand before opening additional sessions.')
  if(actions.length===0)actions.push('Continue reviewing current subscriptions, enrollment events and renewals.')
  return actions.slice(0,5)
}
