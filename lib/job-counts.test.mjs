import test from 'node:test';
import assert from 'node:assert/strict';
import {countOriginalJobs, classifyVisit, jobLocalDate} from './job-counts.mjs';
const job=(id,invoice,description='',amount=0,tech='A')=>({id,invoice_number:invoice,description,total_amount:amount,work_status:'complete unrated',schedule:{scheduled_start_local:'2026-09-15T09:00:00'},assigned_employees:[{first_name:tech,last_name:''}]});
test('linked stages and duplicate API records count one original, per technician',()=>{
 const a=job('a','100-1','washing',100), b=job('b','100-2','sanding',0,'B');
 assert.deepEqual(countOriginalJobs([a,b,a]).perTech,{A:1,B:1});
 assert.equal(countOriginalJobs([a,b,a]).jobsCompleted,1);
 assert.equal(countOriginalJobs([a,b,a]).completedVisits,2);
});
test('callback-only roots excluded; repair-only technician gets no original job credit',()=>{
 const r=countOriginalJobs([job('a','100-1','washing',100),job('b','100-2','CALL BACK',0,'B'),job('c','101','CALL BACK',100)]);
 assert.equal(r.jobsCompleted,1);assert.deepEqual(r.perTech,{A:1});assert.equal(r.correctiveOnlyJobs,1);
});
test('free planned work stays; unknown price-zero work is flagged',()=>{
 const r=countOriginalJobs([job('a','100','sealing'),job('b','101')]);
 assert.equal(r.jobsCompleted,2);assert.equal(r.unclassifiedJobs,1);
});
test('reviewed visit overrides take priority over original-wide rules',()=>{
 const o={'2026-09:100':'p','2026-09:100-2':'r'};
 assert.equal(classifyVisit(job('a','100-2','sanding'),o),'repair');
 assert.equal(classifyVisit(job('b','100-1','fixing'),o),'production');
});
test('paid originals are not reclassified by notes about callbacks',()=>{
 const a=job('a','100','washing',100);a.notes=[{content:'callback next week'}];
 assert.equal(classifyVisit(a),'production');
});
test('calendar boundary uses Toronto date',()=>{
 assert.equal(jobLocalDate({schedule:{scheduled_start:'2026-10-01T01:00:00Z',time_zone:'America/Toronto'}}),'2026-09-30');
});
test('incomplete visits do not enter counts',()=>{
 const a=job('a','100','washing',100);a.work_status='scheduled';assert.equal(countOriginalJobs([a]).jobsCompleted,0);
});
test('future months use grouping and plural callback labels without monthly edits',()=>{
 const a=job('a','100-1','washing',100),b=job('b','100-2','sealing'),c=job('c','101','CALL BACKS'),d=job('d','102','Clips need fixed/replaced');
 for(const j of [a,b,c,d])j.schedule.scheduled_start_local='2027-01-15T09:00:00';
 const r=countOriginalJobs([a,b,c,d]);assert.equal(r.jobsCompleted,1);assert.equal(r.correctiveOnlyJobs,2);
});
