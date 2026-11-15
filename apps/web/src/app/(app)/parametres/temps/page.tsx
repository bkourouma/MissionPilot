import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
import { chargerServeur } from "../../../../lib/api-serveur";
import { UNITE_LIBELLES } from "../../../../lib/cabinet";
import { formaterNombre } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";
import type { ParametresTemps } from "../../../../lib/temps-admin";
import type { ActiviteInterne } from "../../../../lib/temps";
import { AjoutActivite, BasculeActivite, FormulaireParametresTemps } from "./ParametresTemps";

const UNITE_EN = { demi_journee: "Half-day", heure: "Hour" } as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Paramètres des temps", "Time settings") };
}

export default async function PageParametresTemps() {
  await exigerPermission("cabinet.gerer");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const [p, activites] = await Promise.all([
    chargerServeur<ParametresTemps>("/api/temps/parametres"),
    chargerServeur<{ elements: ActiviteInterne[] }>(
      "/api/activites-internes?inclure_inactives=true",
    ),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Temps", "Time")}
        soustitre={t(
          "Unité de saisie, contrôle de la capacité journalière, seuil d'alerte et activités internes non facturables.",
          "Entry unit, daily capacity check, alert threshold and non-billable internal activities.",
        )}
      />
      <Carte titre={t("Saisie et alertes", "Entry and alerts")}>
        {!p.ok ? (
          <EtatErreur
            titre={t("Les paramètres n'ont pas pu être chargés.", "Settings could not be loaded.")}
            message={p.message}
            hrefReessayer="/parametres/temps"
          />
        ) : (
          <div className="mp-pile">
            <p>
              {t(
                `Unité de saisie : ${UNITE_LIBELLES[p.donnees.unite_saisie_temps]}`,
                `Entry unit: ${UNITE_EN[p.donnees.unite_saisie_temps]}`,
              )}
              {p.donnees.unite_saisie_temps === "heure"
                ? t(
                    ` (journée de ${formaterNombre(p.donnees.heures_par_jour, 2, langue)} h)`,
                    ` (${formaterNombre(p.donnees.heures_par_jour, 2, langue)}-hour day)`,
                  )
                : t(" (pas de 0,5 jour)", " (0.5-day steps)")}
              {". "}
              <span className="mp-texte-doux">
                {t("Elle se change dans ", "It can be changed in ")}
                <Link href="/parametres">
                  {t("les informations du cabinet", "the firm information")}
                </Link>
                {t(".", ".")}
              </span>
            </p>
            <FormulaireParametresTemps parametres={p.donnees} />
          </div>
        )}
      </Carte>

      <Carte titre={t("Activités internes", "Internal activities")}>
        <div className="mp-pile">
          {!activites.ok ? (
            <EtatErreur
              titre={t(
                "Les activités n'ont pas pu être chargées.",
                "Activities could not be loaded.",
              )}
              message={activites.message}
              hrefReessayer="/parametres/temps"
            />
          ) : activites.donnees.elements.length === 0 ? (
            <EtatVide
              titre={t("Aucune activité interne.", "No internal activities.")}
              icone="horloge"
            >
              <p>
                {t(
                  "Formation, prospection, administration, congés : ajoutez-les ci-dessous.",
                  "Training, business development, administration, leave: add them below.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul
              className="mp-liste-lignes"
              aria-label={t("Activités internes", "Internal activities")}
            >
              {activites.donnees.elements.map((a) => (
                <li key={a.id} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{a.libelle}</strong>
                    <span className="mp-texte-doux">{`${a.code}${a.est_absence ? t(" · absence", " · absence") : ""}`}</span>
                  </span>
                  {a.actif === false ? (
                    <BadgeStatut tonalite="neutre">{t("Désactivée", "Deactivated")}</BadgeStatut>
                  ) : null}
                  <BasculeActivite activite={a} />
                </li>
              ))}
            </ul>
          )}
          <AjoutActivite />
        </div>
      </Carte>
    </div>
  );
}
