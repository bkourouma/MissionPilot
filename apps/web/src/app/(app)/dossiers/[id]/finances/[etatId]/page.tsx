import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import Link from "next/link";
import { CorrectionsOcr } from "../../../../../../components/ingestion/CorrectionsOcr";
import { DecisionEtat } from "../../../../../../components/dossier/DecisionEtat";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { libellePosteEtat } from "../../../../../../lib/codes-lisibles";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  AVERTISSEMENT_OCR,
  AVERTISSEMENT_OCR_EN,
  etatLuParOcr,
  formaterConstat,
  formaterReference,
  libelleOrigineEtat,
  libelleSectionEtat,
  marqueurOcrLigne,
  statutEtat,
  type EtatDetaille,
} from "../../../../../../lib/dossier";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("État financier", "Financial statement") };
}

/** Détail d'un état : constats du moteur, lignes référencées, revue des écarts. */
export default async function PageEtat({
  params,
}: {
  params: Promise<{ id: string; etatId: string }>;
}) {
  const { id, etatId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(etatId)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const r = await chargerServeur<EtatDetaille>(`/api/dossiers/${id}/etats-financiers/${etatId}`);
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: `/dossiers/${id}/finances`,
    libelle: t("Finances du client", "Client finances"),
  };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("État financier", "Financial statement")} retour={retour} />
        <EtatErreur
          titre={t(
            "L'état financier n'a pas pu être chargé.",
            "The financial statement could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/dossiers/${id}/finances/${etatId}`}
        />
      </div>
    );
  }
  const e = r.donnees;
  const statut = statutEtat(e.statut, langue);
  const ecarts = e.constats.filter((c) => c.statut !== "ok");
  const luParOcr = etatLuParOcr(e);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t(`États financiers ${e.exercice}`, `Financial statements ${e.exercice}`)}
        retour={retour}
        soustitre={`${t("Clôture au", "Closing on")} ${formaterDate(e.date_cloture, "UTC", langue)} · ${libelleOrigineEtat(e.origine, langue)}${e.source_libelle ? ` · ${e.source_libelle}` : ""}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      {luParOcr ? (
        <Alerte
          tonalite="attention"
          titre={t("Lu par reconnaissance de caractères", "Read by character recognition")}
          annonce="aucune"
        >
          <p>{langue === "en" ? AVERTISSEMENT_OCR_EN : AVERTISSEMENT_OCR}</p>
        </Alerte>
      ) : null}

      <Carte titre={t("Contrôles du moteur", "Engine checks")}>
        {e.controles_ok ? (
          <Alerte
            tonalite="succes"
            titre={t("Tous les contrôles passent", "All checks pass")}
            annonce="aucune"
          >
            <p>
              {t(
                "Équilibre du bilan et cohérence du résultat vérifiés : état accepté automatiquement.",
                "Balance sheet balance and result consistency verified: statement accepted automatically.",
              )}
            </p>
          </Alerte>
        ) : (
          <Alerte
            tonalite="attention"
            titre={t("Revue nécessaire", "Review required")}
            annonce="aucune"
          >
            <p>
              {t(
                `${e.ecarts} écart(s) au-delà de la tolérance (${formaterMontantMineur(e.tolerance, e.devise)}), ${e.non_verifiables} contrôle(s) non vérifiable(s). Cet état ne sert aux analyses qu'après une décision humaine motivée.`,
                `${e.ecarts} gap(s) beyond the tolerance (${formaterMontantMineur(e.tolerance, e.devise, "en")}), ${e.non_verifiables} check(s) that cannot be verified. This statement is only used in analyses after a reasoned human decision.`,
              )}
            </p>
          </Alerte>
        )}
        <ul>
          {(ecarts.length > 0 ? ecarts : e.constats).map((c, i) => (
            <li key={`${c.code}-${c.cible ?? ""}-${i}`}>{formaterConstat(c, e.devise, langue)}</li>
          ))}
        </ul>
      </Carte>

      {e.decision ? (
        <Carte titre={t("Décision", "Decision")}>
          <p>
            {e.decision.decision === "accepte" ? t("Accepté", "Accepted") : t("Rejeté", "Rejected")}
            {e.decision.automatique
              ? t(" automatiquement (contrôles passés)", " automatically (checks passed)")
              : e.decision.par
                ? ` ${t("par", "by")} ${e.decision.par.nom}`
                : ""}{" "}
            {t("le", "on")} {formaterDateHeure(e.decision.le, undefined, langue)}.
            {e.decision.motif ? ` ${t("Motif", "Reason")}${t(" : ", ": ")}${e.decision.motif}` : ""}
          </p>
        </Carte>
      ) : e.statut === "en_revue" && peutEcrire ? (
        <Carte titre={t("Revue de l'état", "Statement review")}>
          <DecisionEtat clientId={id} etatId={e.id} controlesOk={e.controles_ok} />
        </Carte>
      ) : null}

      <CorrectionsOcr corrections={e.ingestion?.corrections_ocr} devise={e.devise} />

      {e.statut === "remplace" ? (
        <Alerte tonalite="info" titre={t("État remplacé", "Statement replaced")} annonce="aucune">
          <p>
            {t(
              "Un état plus récent du même exercice l'a remplacé ; il reste consultable pour l'historique.",
              "A more recent statement for the same fiscal year has replaced it; it remains available for the history.",
            )}
          </p>
        </Alerte>
      ) : null}

      <Carte titre={t("Lignes et références", "Lines and references")}>
        <Tableau
          legende={t(`Lignes de l'état ${e.exercice}`, `Lines of the ${e.exercice} statement`)}
          lignes={e.lignes}
          cleLigne={(l) => String(l.rang)}
          colonnes={[
            {
              cle: "section",
              entete: "Section",
              rendu: (l) => libelleSectionEtat(l.section, langue),
            },
            {
              cle: "code",
              entete: t("Poste", "Line item"),
              rendu: (l) =>
                l.parent
                  ? `${libellePosteEtat(l.code, langue)} (${t("dans", "in")} ${libellePosteEtat(l.parent, langue)})`
                  : libellePosteEtat(l.code, langue),
            },
            { cle: "libelle", entete: t("Libellé", "Label") },
            {
              cle: "montant",
              entete: t("Montant", "Amount"),
              alignement: "droite",
              rendu: (l) => {
                const marqueur = marqueurOcrLigne(l, langue);
                return (
                  <>
                    {formaterMontantMineur(l.montant, e.devise, langue)}
                    {marqueur ? (
                      <>
                        <br />
                        <small>
                          <strong>{marqueur}</strong>
                        </small>
                      </>
                    ) : null}
                  </>
                );
              },
            },
            {
              cle: "reference",
              entete: t("Référence", "Reference"),
              rendu: (l) => formaterReference(l.reference, langue),
            },
          ]}
        />
        <p>
          {t("Importé par", "Imported by")} {e.importe_par.nom} {t("le", "on")}{" "}
          {formaterDateHeure(e.cree_le, undefined, langue)}
          {e.fichier
            ? ` · ${t("fichier", "file")} ${e.fichier.nom ?? t("sans nom", "unnamed")} (${t("empreinte", "fingerprint")} ${e.fichier.sha256.slice(0, 12)}…)`
            : ""}
          .
        </p>
        {e.ingestion ? (
          <p>
            <Link href={`/dossiers/${id}/finances/documents/${e.ingestion.document_id}`}>
              {t("Voir le document importé", "View the imported document")}
            </Link>
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
