import { describe, expect, it } from '@jest/globals';
import { deliveriesSchema, eventSchema, taskChanged } from '../dist/contracts.js';
import { verifyOrigin } from '../dist/access.js';
import { config } from '../dist/config.js';

const uuid='00000000-0000-4000-8000-000000000001';
const event={version:1,id:uuid,orgId:uuid,type:'task.completed',correlationId:'test-123',occurredAt:'2026-01-01T00:00:00Z',payload:{recipientId:uuid}};

describe('event validation',()=>{
  it('only accepts v1 and tenant-scoped IDs',()=>{
    expect(eventSchema.safeParse(event).success).toBe(true);
    expect(eventSchema.safeParse({...event,version:2}).success).toBe(false);
    expect(eventSchema.safeParse({...event,orgId:'other'}).success).toBe(false);
  });
  it('validates notification recipients and only broadcasts task mutation events',()=>{
    expect(deliveriesSchema.safeParse([{id:uuid,userId:uuid,title:'Done'}]).success).toBe(true);
    expect(deliveriesSchema.safeParse([{id:uuid,userId:'',title:'Done'}]).success).toBe(false);
    expect(taskChanged('task.completed')).toBe(true);
    expect(taskChanged('subscription.updated')).toBe(false);
  });
});

describe('cross-origin requests',()=>{
  it('accepts the configured origin and blocks cross-site requests',()=>{
    expect(()=>verifyOrigin(config.origin,'same-origin')).not.toThrow();
    expect(()=>verifyOrigin('https://untrusted.example','same-origin')).toThrow();
    expect(()=>verifyOrigin(undefined,'cross-site')).toThrow();
  });
});
