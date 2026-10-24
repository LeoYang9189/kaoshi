import {sqliteTable,text,integer,real,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('profiles',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),name:text('name').notNull(),code:text('code').notNull(),createdAt:integer('created_at').notNull()
},t=>[index('profiles_owner').on(t.ownerId),uniqueIndex('profiles_owner_code').on(t.ownerId,t.code)]);
export const attempts=sqliteTable('attempts',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),profileId:text('profile_id').notNull().references(()=>profiles.id),paperId:text('paper_id').notNull(),startedAt:integer('started_at').notNull(),deadline:integer('deadline').notNull(),submittedAt:integer('submitted_at'),durationMinutes:integer('duration_minutes').notNull(),status:text('status').notNull(),answers:text('answers').notNull().default('{}'),revision:integer('revision').notNull().default(0),score:real('score'),totalPoints:real('total_points').notNull(),correctCount:integer('correct_count'),questionCount:integer('question_count').notNull(),accuracy:real('accuracy'),timedOut:integer('timed_out').notNull().default(0)
},t=>[index('attempts_owner').on(t.ownerId),index('attempts_profile').on(t.profileId)]);
