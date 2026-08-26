/**
 * The shell's whole vocabulary, in the two languages the web client speaks.
 *
 * It is a flat map rather than a framework because the shell is two screens
 * long and gains nothing from a loader, a namespace or a plural engine. What it
 * DOES share with the app is tone: no exclamation marks, no "Oops", no blame.
 * An error here names what was tried, what happened, and what to do next.
 */
export type Lang = "en" | "ar";

const en = {
  wordmark: "Vellum",
  connectLede: "Point this at your vault.",
  serverLabel: "Server address",
  serverHint: "A bare name is assumed to be https. Addresses on your own network are assumed to be http.",
  serverPlaceholder: "vellum.example.com",
  connect: "Connect",
  connecting: "Connecting…",
  connectingTo: (host: string) => `Connecting to ${host}…`,
  chooseAnother: "Choose another server",
  savedTitle: "Saved servers",
  forget: "Forget",
  forgetOne: (host: string) => `Forget ${host}`,
  signInNote: "This vault asks for a password. You will be asked for it there.",

  errEmpty: "Type the address of your Vellum server.",
  errScheme: "Only http and https addresses can be opened.",
  errUrl: "That is not an address this can open.",
  errUnreachable: (host: string) => `Could not reach ${host}. Check the address, and that the server is running.`,
  errTimeout: (host: string) => `${host} did not answer in time. It may be asleep, or on a network this phone cannot see.`,
  errNotVellum: (host: string) => `${host} answered, but not as a Vellum server.`,
  errStatus: (host: string, status: number) => `${host} answered with ${status}.`,

  captureTitle: "Capture",
  captureLede: (host: string) => `To ${host}`,
  captureNoteLabel: "Note",
  captureBody: "Text",
  captureSave: "Save to inbox",
  captureSaving: "Saving…",
  captureSaved: "Saved.",
  captureCancel: "Cancel",
  captureEmpty: "Nothing was shared.",
  captureNoServer: "No server yet. Open Vellum and connect first.",
  captureFailed: "The server refused the write. Nothing was saved.",
  captureUnauthorized: (host: string) => `${host} did not recognise this session. Open Vellum, sign in, and share again.`,
  captureTargetIs: (path: string) => `Appending to ${path}`,
};

type Copy = typeof en;

const ar: Copy = {
  wordmark: "ڤيلوم",
  connectLede: "وجّه هذا إلى خزانتك.",
  serverLabel: "عنوان الخادم",
  serverHint: "الاسم المجرّد يُفترض https. وعناوين شبكتك المحليّة تُفترض http.",
  serverPlaceholder: "vellum.example.com",
  connect: "اتّصل",
  connecting: "…جارٍ الاتّصال",
  connectingTo: (host: string) => `…جارٍ الاتّصال بـ ${host}`,
  chooseAnother: "اختر خادمًا آخر",
  savedTitle: "الخوادم المحفوظة",
  forget: "انسَ",
  forgetOne: (host: string) => `انسَ ${host}`,
  signInNote: "هذه الخزانة تطلب كلمة مرور. ستُسأل عنها هناك.",

  errEmpty: "اكتب عنوان خادم ڤيلوم.",
  errScheme: "لا يمكن فتح غير عناوين http و https.",
  errUrl: "هذا ليس عنوانًا يمكن فتحه.",
  errUnreachable: (host: string) => `تعذّر الوصول إلى ${host}. تحقّق من العنوان ومن أنّ الخادم يعمل.`,
  errTimeout: (host: string) => `لم يُجب ${host} في الوقت المتاح. قد يكون نائمًا أو على شبكة لا يراها هذا الهاتف.`,
  errNotVellum: (host: string) => `أجاب ${host}، لكن ليس بوصفه خادم ڤيلوم.`,
  errStatus: (host: string, status: number) => `أجاب ${host} بالرمز ${status}.`,

  captureTitle: "التقاط",
  captureLede: (host: string) => `إلى ${host}`,
  captureNoteLabel: "ملاحظة",
  captureBody: "النص",
  captureSave: "احفظ في الوارد",
  captureSaving: "…جارٍ الحفظ",
  captureSaved: "حُفظ.",
  captureCancel: "ألغِ",
  captureEmpty: "لم تُشارَك أيّ مادّة.",
  captureNoServer: "لا خادم بعد. افتح ڤيلوم واتّصل أوّلًا.",
  captureFailed: "رفض الخادم الكتابة. لم يُحفظ شيء.",
  captureUnauthorized: (host: string) => `لم يتعرّف ${host} على هذه الجلسة. افتح ڤيلوم وسجّل الدخول ثمّ شارك مجدّدًا.`,
  captureTargetIs: (path: string) => `يُلحق بـ ${path}`,
};

/** The phone's language, narrowed to the two the app has words for. */
export function pickLang(): Lang {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    if (typeof tag === "string" && tag.toLowerCase().startsWith("ar")) return "ar";
  }
  return "en";
}

export const lang: Lang = pickLang();
export const dir: "ltr" | "rtl" = lang === "ar" ? "rtl" : "ltr";
export const t: Copy = lang === "ar" ? ar : en;
