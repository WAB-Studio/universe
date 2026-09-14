import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
await sql`delete from reading.word_texts where headword = 'snuff'`;
await sql`insert into reading.word_texts (headword, definition, example_en, example_es, model, translations, translations_asked)
  values ('snuff', null, 'seed2 en', 'seed2 es', 'gpt-5-nano', null, false)`;
console.log("seeded");
await sql.end();
