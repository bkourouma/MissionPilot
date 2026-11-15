import type { Metadata } from "next";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  cheminModeles,
  estGabarit,
  TAILLE_PAGE_CHOIX,
  type GabaritResume,
  type ModeleResume,
  type PageQuestionnaires,
  type SaisieModele,
} from "../../../../lib/questionnaires";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireModele } from "../FormulaireModele";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouveau modèle de questionnaire", "New questionnaire template") };
}

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Création d'un modèle : copie d'un gabarit (?gabarit=), d'un modèle (?copie=), ou vierge. */
export default async function PageNouveauModele({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  await exigerPermission("questionnaire.gerer");
  const p = await searchParams;
  const [gabarits, modeles] = await Promise.all([
    chargerServeur<{ elements: GabaritResume[] }>("/api/questionnaires/gabarits"),
    chargerServeur<PageQuestionnaires<ModeleResume>>(cheminModeles(null, TAILLE_PAGE_CHOIX)),
  ]);
  const listeGabarits = gabarits.ok ? gabarits.donnees.elements : [];
  const listeModeles = modeles.ok
    ? modeles.donnees.elements.map((m) => ({ id: m.id, titre: m.titre, code: m.code }))
    : [];
  const echecs = [
    gabarits.ok
      ? null
      : t(
          `Les gabarits n'ont pas pu être chargés : ${gabarits.message}`,
          `The templates could not be loaded: ${gabarits.message}`,
        ),
    modeles.ok
      ? null
      : t(
          `Les modèles du cabinet n'ont pas pu être chargés : ${modeles.message}`,
          `The firm templates could not be loaded: ${modeles.message}`,
        ),
  ].filter((m): m is string => m !== null);
  const gabarit = premier(p.gabarit);
  const copie = premier(p.copie);
  const copieConnue = listeModeles.some((m) => m.id === copie);
  const saisieInitiale: SaisieModele = {
    source: copieConnue ? "copie" : listeGabarits.length > 0 ? "gabarit" : "vierge",
    gabarit: estGabarit(gabarit) ? gabarit : "",
    modele_id: copieConnue ? copie : "",
    code: "",
    titre: "",
  };

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouveau modèle de questionnaire", "New questionnaire template")}
        retour={{ href: "/questionnaires", libelle: t("Questionnaires", "Questionnaires") }}
      />
      {echecs.length > 0 ? (
        <Alerte tonalite="attention" titre={t("Choix incomplets", "Incomplete choices")}>
          {echecs.map((m) => (
            <p key={m}>{m}</p>
          ))}
          <p>{t("Rechargez la page pour réessayer.", "Reload the page to try again.")}</p>
        </Alerte>
      ) : null}
      {modeles.ok && modeles.donnees.curseur_suivant ? (
        <Alerte tonalite="info">
          <p>
            {t(
              `Seuls les ${TAILLE_PAGE_CHOIX} premiers modèles (par titre) sont proposés à la copie.`,
              `Only the first ${TAILLE_PAGE_CHOIX} templates (by title) are offered for copying.`,
            )}
          </p>
        </Alerte>
      ) : null}
      <Carte>
        <FormulaireModele
          gabarits={listeGabarits}
          modeles={listeModeles}
          saisieInitiale={saisieInitiale}
        />
      </Carte>
    </div>
  );
}
