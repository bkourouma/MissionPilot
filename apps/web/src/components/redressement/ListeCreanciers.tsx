import Link from "next/link";
import { creerTraduire, type RedCreancierResume } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  hrefCreancierRed,
  libelleCategorieCreancier,
  libelleStatutAccord,
  tonaliteStatutAccord,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";

/**
 * Registre des créanciers : encours restant, échu, accord et sa prochaine échéance, tels que
 * l'API les calcule (la situation est recalculée à chaque lecture, jamais stockée).
 */
export async function ListeCreanciers({
  missionId,
  elements,
  devise,
}: {
  missionId: string;
  elements: RedCreancierResume[];
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  return (
    <Tableau
      legende={t("Registre des créanciers", "Creditor register")}
      messageVide={t("Aucun créancier enregistré.", "No creditor recorded.")}
      colonnes={[
        {
          cle: "nom",
          entete: t("Créancier", "Creditor"),
          rendu: (c: RedCreancierResume) => (
            <>
              <Link href={hrefCreancierRed(missionId, c.id)}>{c.nom}</Link>
              {c.actif ? null : (
                <span className="mp-texte-doux"> ({t("inactif", "inactive")})</span>
              )}
            </>
          ),
        },
        {
          cle: "categorie",
          entete: t("Catégorie", "Category"),
          rendu: (c) => libelleCategorieCreancier(c.categorie, langue),
        },
        {
          cle: "garanti",
          entete: t("Garanti", "Secured"),
          rendu: (c) => (c.garanti ? t("Oui", "Yes") : t("Non", "No")),
        },
        {
          cle: "encours",
          entete: t("Encours restant", "Outstanding"),
          alignement: "droite",
          rendu: (c) => (
            <span className="mp-red-valeur">
              {formaterMontantMineur(c.situation.encours_restant, devise, langue)}
            </span>
          ),
        },
        {
          cle: "echu",
          entete: t("Échu", "Overdue"),
          alignement: "droite",
          rendu: (c) => (
            <span className="mp-red-valeur">
              {formaterMontantMineur(c.situation.echu, devise, langue)}
            </span>
          ),
        },
        {
          cle: "accord",
          entete: t("Accord", "Agreement"),
          rendu: (c) =>
            c.situation.accord ? (
              <BadgeStatut tonalite={tonaliteStatutAccord(c.situation.accord.statut)}>
                {libelleStatutAccord(c.situation.accord.statut, langue)}
              </BadgeStatut>
            ) : (
              "—"
            ),
        },
        {
          cle: "prochaine",
          entete: t("Prochaine échéance", "Next installment"),
          rendu: (c) => {
            const p = c.situation.accord?.prochaine_non_soldee;
            return p
              ? `${formaterDate(p.date, "UTC", langue)} : ${formaterMontantMineur(p.montant_restant, devise, langue)}`
              : "—";
          },
        },
      ]}
      lignes={elements}
      cleLigne={(c) => c.id}
    />
  );
}
