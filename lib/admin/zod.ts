import * as z from 'zod';

/*
 * Every admin schema imports `z` from here, so zod's built-in messages are in
 * Vietnamese wherever the schema runs (server action or browser). z.config is
 * global to the zod instance; importing it here once is enough. Fields people
 * type into still get their own message (spec §7.3): the built-in ones are
 * generic ("Quá nhỏ: mong đợi string có >=12 ký tự").
 */
z.config(z.locales.vi());

export { z };
