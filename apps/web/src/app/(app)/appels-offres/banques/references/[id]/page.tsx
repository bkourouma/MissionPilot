import type { Metadata } from "next";
import {
  FormulairePiece,
  FormulaireReference,
  FormulaireRetraitPiece,
} from "../../../../../../components/banque-ao/FormulairesReferences";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import {
  droitsBanqueAo,
  libelleRoleReference,
  libelleTypeAttestation,
  RACINE_BANQUES,
  type ReferenceDetail,
} from "../../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterTaille } from "../../../../../../lib/fichiers";
import { formaterDate, formaterMontantMineur } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { montantVersSaisie } from "../../../../../../lib/saisie";
import { obtenirSession } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Référence", "Reference") };
}

/** Fiche d'une référence : version courante, pièces justificatives, historique. */
export default async function PageDetailReference({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<ReferenceDetail>(
    `/api/banque-ao/references/${encodeURIComponent(id)}`,
  );
  const retour = { href: `${RACINE_BANQUES}/references`, libelle: t("Références", "References") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Référence", "Reference")} retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/references/${encodeURIComponent(id)}`}
          titre={t(
            "Cette référence n'a pas pu être chargée.",
            "This reference could not be loaded.",
          )}
          message={r.message}
        />
      </div>
    );
  }
  const ref = r.donnees;
  const c = ref.courante;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c.titre}
        soustitre={`${c.client_nom} — ${c.pays}${c.bailleur ? ` — ${c.bailleur}` : ""}`}
        retour={retour}
      />
      <Carte titre={t("Référence", "Reference")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Montant du marché", "Contract amount")}</dt>
            <dd>{formaterMontantMineur(c.montant, c.devise, langue)}</dd>
          </div>
          <div>
            <dt>{t("Période", "Period")}</dt>
            <dd>
              {formaterDate(c.date_debut, "UTC", langue)} –{" "}
              {c.date_fin ? formaterDate(c.date_fin, "UTC", langue) : t("en cours", "ongoing")}
            </dd>
          </div>
          <div>
            <dt>{t("Rôle du cabinet", "Firm's role")}</dt>
            <dd>{libelleRoleReference(c.role_cabinet, langue)}</dd>
          </div>
          <div>
            <dt>{t("Secteurs", "Sectors")}</dt>
            <dd>{c.secteurs.join(", ") || "—"}</dd>
          </div>
        </dl>
        {c.description ? <p>{c.description}</p> : null}
      </Carte>
      <Carte titre={t("Pièces justificatives", "Supporting documents")}>
        {ref.attestations.length === 0 ? <p>{t("Aucune pièce.", "No documents.")}</p> : null}
        <ul>
          {ref.attestations.map((a) => (
            <li key={a.id}>
              {libelleTypeAttestation(a.type, langue)} — {a.emetteur},{" "}
              {formaterDate(a.date_attestation, "UTC", langue)}{" "}
              {a.retiree ? (
                <BadgeStatut tonalite="neutre">
                  {t(`Retirée : ${a.motif_retrait ?? ""}`, `Withdrawn: ${a.motif_retrait ?? ""}`)}
                </BadgeStatut>
              ) : (
                <>
                  <a href={`/api/banque-ao/attestations/${encodeURIComponent(a.id)}/fichier`}>
                    {a.fichier.nom}
                  </a>{" "}
                  ({formaterTaille(a.fichier.taille, langue)})
                  {droits.gerer ? (
                    <details className="mp-details">
                      <summary>{t("Retirer cette pièce", "Withdraw this document")}</summary>
                      <FormulaireRetraitPiece attestationId={a.id} />
                    </details>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
        {droits.gerer ? <FormulairePiece referenceId={ref.id} /> : null}
      </Carte>
      <Carte titre={t("Historique des versions", "Version history")}>
        <ul>
          {ref.versions.map((v) => (
            <li key={v.version}>
              {t(
                `Version ${v.version} du ${formaterDate(v.cree_le)}`,
                `Version ${v.version} of ${formaterDate(v.cree_le, "UTC", langue)}`,
              )}
              {v.motif ? ` : ${v.motif}` : t(" (création)", " (creation)")}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.gerer ? (
        <Carte titre={t("Nouvelle version", "New version")}>
          <FormulaireReference
            referenceId={ref.id}
            initial={{
              titre: c.titre,
              client_nom: c.client_nom,
              pays: c.pays,
              secteurs: c.secteurs.join(", "),
              bailleur: c.bailleur ?? "",
              montant: montantVersSaisie(c.montant, c.devise),
              devise: c.devise,
              date_debut: c.date_debut,
              date_fin: c.date_fin ?? "",
              role_cabinet: c.role_cabinet,
              description: c.description ?? "",
            }}
          />
        </Carte>
      ) : null}
    </div>
  );
}
