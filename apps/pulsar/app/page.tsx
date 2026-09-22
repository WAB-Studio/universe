import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("common");

  return (
    <main>
      <h1>{t("appName")}</h1>
      <p>{t("tagline")}</p>
    </main>
  );
}
