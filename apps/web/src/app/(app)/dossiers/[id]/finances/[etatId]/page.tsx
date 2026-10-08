import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission, SECTION_ETAT_LIBELLES } from "@missionpilot/shared";
import { DecisionEtat } from "../../../../../../components/dossier/DecisionEtat";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  formaterConstat,
  formaterReference,
  ORIGINE_ETAT_LIBELLES,
  STATUT_ETAT,
  type EtatDetaille,
} from "../../../../../../lib/dossier";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "État financier" };

/** Détail d'un état : constats du moteur, lignes référencées, revue des écarts. */
export default async function PageEtat({
  params,
}: {
  params: Promise<{ id: string; etatId: string }>;
}) {
  const { id, etatId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(etatId)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const r = await chargerServeur<EtatDetaille>(`/api/dossiers/${id}/etats-financiers/${etatId}`);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: `/dossiers/${id}/finances`, libelle: "Finances du client" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="État financier" retour={retour} />
        <EtatErreur
          titre="L'état financier n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/dossiers/${id}/finances/${etatId}`}
        />
      </div>
    );
  }
  const e = r.donnees;
  const statut = STATUT_ETAT[e.statut];
  const ecarts = e.constats.filter((c) => c.statut !== "ok");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`États financiers ${e.exercice}`}
        retour={retour}
        soustitre={`Clôture au ${formaterDate(e.date_cloture)} · ${ORIGINE_ETAT_LIBELLES[e.origine]}${e.source_libelle ? ` · ${e.source_libelle}` : ""}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <Carte titre="Contrôles du moteur">
        {e.controles_ok ? (
          <Alerte tonalite="succes" titre="Tous les contrôles passent" annonce="aucune">
            <p>
              Équilibre du bilan et cohérence du résultat vérifiés : état accepté automatiquement.
            </p>
          </Alerte>
        ) : (
          <Alerte tonalite="attention" titre="Revue nécessaire" annonce="aucune">
            <p>
              {e.ecarts} écart(s) au-delà de la tolérance (
              {formaterMontantMineur(e.tolerance, e.devise)}), {e.non_verifiables} contrôle(s) non
              vérifiable(s). Cet état ne sert aux analyses qu&apos;après une décision humaine
              motivée.
            </p>
          </Alerte>
        )}
        <ul>
          {(ecarts.length > 0 ? ecarts : e.constats).map((c, i) => (
            <li key={`${c.code}-${c.cible ?? ""}-${i}`}>{formaterConstat(c, e.devise)}</li>
          ))}
        </ul>
      </Carte>

      {e.decision ? (
        <Carte titre="Décision">
          <p>
            {e.decision.decision === "accepte" ? "Accepté" : "Rejeté"}
            {e.decision.automatique
              ? " automatiquement (contrôles passés)"
              : e.decision.par
                ? ` par ${e.decision.par.nom}`
                : ""}{" "}
            le {formaterDateHeure(e.decision.le)}.
            {e.decision.motif ? ` Motif : ${e.decision.motif}` : ""}
          </p>
        </Carte>
      ) : e.statut === "en_revue" && peutEcrire ? (
        <Carte titre="Revue de l'état">
          <DecisionEtat clientId={id} etatId={e.id} controlesOk={e.controles_ok} />
        </Carte>
      ) : null}

      {e.statut === "remplace" ? (
        <Alerte tonalite="info" titre="État remplacé" annonce="aucune">
          <p>
            Un état plus récent du même exercice l&apos;a remplacé ; il reste consultable pour
            l&apos;historique.
          </p>
        </Alerte>
      ) : null}

      <Carte titre="Lignes et références">
        <Tableau
          legende={`Lignes de l'état ${e.exercice}`}
          lignes={e.lignes}
          cleLigne={(l) => String(l.rang)}
          colonnes={[
            { cle: "section", entete: "Section", rendu: (l) => SECTION_ETAT_LIBELLES[l.section] },
            {
              cle: "code",
              entete: "Poste",
              rendu: (l) => (l.parent ? `${l.code} (dans ${l.parent})` : l.code),
            },
            { cle: "libelle", entete: "Libellé" },
            {
              cle: "montant",
              entete: "Montant",
              alignement: "droite",
              rendu: (l) => formaterMontantMineur(l.montant, e.devise),
            },
            { cle: "reference", entete: "Référence", rendu: (l) => formaterReference(l.reference) },
          ]}
        />
        <p>
          Importé par {e.importe_par.nom} le {formaterDateHeure(e.cree_le)}
          {e.fichier
            ? ` · fichier ${e.fichier.nom ?? "sans nom"} (empreinte ${e.fichier.sha256.slice(0, 12)}…)`
            : ""}
          .
        </p>
      </Carte>
    </div>
  );
}
