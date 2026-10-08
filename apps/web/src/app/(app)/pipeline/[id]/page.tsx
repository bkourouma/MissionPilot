import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure, formaterMontantMineur } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { nomPersonne } from "../../../../lib/personnes";
import {
  ETAPE_LIBELLES,
  formaterProbabilite,
  STATUT_OPPORTUNITE,
  type Opportunite,
} from "../../../../lib/pipeline";
import { STATUT_PROPOSITION, type Proposition } from "../../../../lib/propositions";
import { chargerPersonnes, chargerTypesActifs } from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { CarteCommentaires } from "../../../../components/collaboration/CarteCommentaires";
import { ActionsOpportunite } from "./ActionsOpportunite";
import { GenerationProposition } from "./GenerationProposition";

export const metadata: Metadata = { title: "Opportunité" };

export default async function PageOpportunite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const [r, propositions, types, personnes] = await Promise.all([
    chargerServeur<Opportunite>(`/api/opportunites/${id}`),
    chargerServeur<{ elements: Proposition[] }>(`/api/opportunites/${id}/propositions`),
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Opportunité" retour={{ href: "/pipeline", libelle: "Pipeline" }} />
        <EtatErreur
          titre="L'opportunité n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/pipeline/${id}`}
        />
      </div>
    );
  }
  const o = r.donnees;
  const ouverte = o.statut === "ouverte";
  const statut = STATUT_OPPORTUNITE[o.statut];
  const nomType = (tid: string | null) =>
    tid ? (types.find((t) => t.valeur === tid)?.libelle ?? "Type archivé") : "—";
  const listePropositions = propositions.ok ? propositions.donnees.elements : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={o.intitule}
        retour={{ href: "/pipeline", libelle: "Pipeline" }}
        soustitre={o.client_raison_sociale}
        badges={
          <>
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            {ouverte ? (
              <BadgeStatut tonalite="neutre" sansIcone>
                {`Étape : ${ETAPE_LIBELLES[o.etape]}`}
              </BadgeStatut>
            ) : null}
          </>
        }
        actions={
          ouverte ? (
            <Link href={`/pipeline/${o.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>Modifier</span>
            </Link>
          ) : null
        }
      />

      <Carte titre="Caractéristiques">
        <dl className="mp-liste-def">
          <div>
            <dt>Client</dt>
            <dd>
              <Link href={`/clients/${o.client_id}`}>{o.client_raison_sociale}</Link>
            </dd>
          </div>
          <div>
            <dt>Type de mission envisagé</dt>
            <dd>{nomType(o.type_mission_id)}</dd>
          </div>
          <div>
            <dt>Montant estimé</dt>
            <dd>{formaterMontantMineur(o.montant_estime, o.devise)}</dd>
          </div>
          <div>
            <dt>Probabilité de gain</dt>
            <dd>{formaterProbabilite(o.probabilite)}</dd>
          </div>
          <div>
            <dt>Responsable</dt>
            <dd>{nomPersonne(o.responsable_id, personnes)}</dd>
          </div>
          <div>
            <dt>Clôture prévue</dt>
            <dd>{formaterDate(o.date_cloture_prevue)}</dd>
          </div>
          {o.cloturee_le ? (
            <div>
              <dt>Close le</dt>
              <dd>{formaterDateHeure(o.cloturee_le)}</dd>
            </div>
          ) : null}
          {o.motif_perte ? (
            <div>
              <dt>Motif de la perte</dt>
              <dd className="mp-texte-preserve">{o.motif_perte}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      {ouverte ? (
        <ActionsOpportunite
          opportuniteId={o.id}
          etape={o.etape}
          supprimable={propositions.ok && listePropositions.length === 0}
        />
      ) : null}

      <section aria-labelledby="titre-propositions" className="mp-pile">
        <h2 id="titre-propositions" className="mp-section__titre">
          Propositions
        </h2>
        {!propositions.ok ? (
          <EtatErreur
            titre="Les propositions n'ont pas pu être chargées."
            message={propositions.message}
            hrefReessayer={`/pipeline/${id}`}
          />
        ) : listePropositions.length === 0 ? (
          <EtatVide titre="Aucune proposition pour cette opportunité." icone="facture">
            {ouverte ? (
              <p>
                Générez la proposition depuis un type du catalogue : découpage et jours par grade
                arrivent pré-remplis.
              </p>
            ) : null}
          </EtatVide>
        ) : (
          <Tableau
            legende="Versions de la proposition"
            lignes={listePropositions}
            cleLigne={(p) => p.id}
            colonnes={[
              {
                cle: "numero",
                entete: "Version",
                rendu: (p) => (
                  <Link href={`/pipeline/propositions/${p.id}`} className="mp-lien-ligne">
                    {`Version ${p.numero}`}
                  </Link>
                ),
              },
              { cle: "intitule", entete: "Intitulé" },
              { cle: "type", entete: "Type", rendu: (p) => nomType(p.type_mission_id) },
              { cle: "devise", entete: "Devise" },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (p) => (
                  <BadgeStatut tonalite={STATUT_PROPOSITION[p.statut].tonalite}>
                    {STATUT_PROPOSITION[p.statut].libelle}
                  </BadgeStatut>
                ),
              },
              { cle: "cree", entete: "Créée le", rendu: (p) => formaterDateHeure(p.cree_le) },
            ]}
          />
        )}
        {ouverte ? (
          <GenerationProposition
            opportuniteId={o.id}
            types={types.map(({ valeur, libelle }) => ({ valeur, libelle }))}
            typeParDefaut={o.type_mission_id ?? ""}
          />
        ) : null}
      </section>
      <CarteCommentaires
        entiteType="opportunite"
        entiteId={o.id}
        utilisateur={utilisateur}
        nomElement={`l'opportunité ${o.intitule}`}
      />
    </div>
  );
}
