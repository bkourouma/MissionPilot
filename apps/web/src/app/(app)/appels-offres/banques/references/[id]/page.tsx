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
import { montantVersSaisie } from "../../../../../../lib/saisie";
import { obtenirSession } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Référence" };

/** Fiche d'une référence : version courante, pièces justificatives, historique. */
export default async function PageDetailReference({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<ReferenceDetail>(
    `/api/banque-ao/references/${encodeURIComponent(id)}`,
  );
  const retour = { href: `${RACINE_BANQUES}/references`, libelle: "Références" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Référence" retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/references/${encodeURIComponent(id)}`}
          titre="Cette référence n'a pas pu être chargée."
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
      <Carte titre="Référence">
        <dl className="mp-liste-def">
          <div>
            <dt>Montant du marché</dt>
            <dd>{formaterMontantMineur(c.montant, c.devise)}</dd>
          </div>
          <div>
            <dt>Période</dt>
            <dd>
              {formaterDate(c.date_debut)} – {c.date_fin ? formaterDate(c.date_fin) : "en cours"}
            </dd>
          </div>
          <div>
            <dt>Rôle du cabinet</dt>
            <dd>{libelleRoleReference(c.role_cabinet)}</dd>
          </div>
          <div>
            <dt>Secteurs</dt>
            <dd>{c.secteurs.join(", ") || "—"}</dd>
          </div>
        </dl>
        {c.description ? <p>{c.description}</p> : null}
      </Carte>
      <Carte titre="Pièces justificatives">
        {ref.attestations.length === 0 ? <p>Aucune pièce.</p> : null}
        <ul>
          {ref.attestations.map((a) => (
            <li key={a.id}>
              {libelleTypeAttestation(a.type)} — {a.emetteur}, {formaterDate(a.date_attestation)}{" "}
              {a.retiree ? (
                <BadgeStatut tonalite="neutre">{`Retirée : ${a.motif_retrait ?? ""}`}</BadgeStatut>
              ) : (
                <>
                  <a href={`/api/banque-ao/attestations/${encodeURIComponent(a.id)}/fichier`}>
                    {a.fichier.nom}
                  </a>{" "}
                  ({formaterTaille(a.fichier.taille)})
                  {droits.gerer ? (
                    <details className="mp-details">
                      <summary>Retirer cette pièce</summary>
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
      <Carte titre="Historique des versions">
        <ul>
          {ref.versions.map((v) => (
            <li key={v.version}>
              Version {v.version} du {formaterDate(v.cree_le)}
              {v.motif ? ` : ${v.motif}` : " (création)"}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.gerer ? (
        <Carte titre="Nouvelle version">
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
