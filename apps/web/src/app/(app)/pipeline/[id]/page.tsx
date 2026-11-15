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
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
  libelleDevise,
} from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { nomPersonne } from "../../../../lib/personnes";
import {
  libelleEtape,
  formaterProbabilite,
  statutOpportunite,
  type Opportunite,
} from "../../../../lib/pipeline";
import { statutProposition, type Proposition } from "../../../../lib/propositions";
import { chargerPersonnes, chargerTypesActifs } from "../../../../lib/referentiels-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { CarteCommentaires } from "../../../../components/collaboration/CarteCommentaires";
import { ActionsOpportunite } from "./ActionsOpportunite";
import { GenerationProposition } from "./GenerationProposition";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Opportunité", "Opportunity") };
}

export default async function PageOpportunite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await obtenirT();
  const langue = await obtenirLangue();
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
        <EnteteDePage
          titre={tr("Opportunité", "Opportunity")}
          retour={{ href: "/pipeline", libelle: tr("Pipeline", "Pipeline") }}
        />
        <EtatErreur
          titre={tr(
            "L'opportunité n'a pas pu être chargée.",
            "The opportunity could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/pipeline/${id}`}
        />
      </div>
    );
  }
  const o = r.donnees;
  const ouverte = o.statut === "ouverte";
  const statut = statutOpportunite(o.statut, langue);
  const nomType = (tid: string | null) =>
    tid
      ? (types.find((t) => t.valeur === tid)?.libelle ?? tr("Type archivé", "Archived type"))
      : "—";
  const listePropositions = propositions.ok ? propositions.donnees.elements : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={o.intitule}
        retour={{ href: "/pipeline", libelle: tr("Pipeline", "Pipeline") }}
        soustitre={o.client_raison_sociale}
        badges={
          <>
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            {ouverte ? (
              <BadgeStatut tonalite="neutre" sansIcone>
                {`${tr("Étape : ", "Stage: ")}${libelleEtape(o.etape, langue)}`}
              </BadgeStatut>
            ) : null}
          </>
        }
        actions={
          ouverte ? (
            <Link href={`/pipeline/${o.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>{tr("Modifier", "Edit")}</span>
            </Link>
          ) : null
        }
      />

      <Carte titre={tr("Caractéristiques", "Characteristics")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{tr("Client", "Client")}</dt>
            <dd>
              <Link href={`/clients/${o.client_id}`}>{o.client_raison_sociale}</Link>
            </dd>
          </div>
          <div>
            <dt>{tr("Type de mission envisagé", "Planned engagement type")}</dt>
            <dd>{nomType(o.type_mission_id)}</dd>
          </div>
          <div>
            <dt>{tr("Montant estimé", "Estimated amount")}</dt>
            <dd>{formaterMontantMineur(o.montant_estime, o.devise, langue)}</dd>
          </div>
          <div>
            <dt>{tr("Probabilité de gain", "Win probability")}</dt>
            <dd>{formaterProbabilite(o.probabilite, langue)}</dd>
          </div>
          <div>
            <dt>{tr("Responsable", "Owner")}</dt>
            <dd>{nomPersonne(o.responsable_id, personnes, langue)}</dd>
          </div>
          <div>
            <dt>{tr("Clôture prévue", "Expected close date")}</dt>
            <dd>{formaterDate(o.date_cloture_prevue, "UTC", langue)}</dd>
          </div>
          {o.cloturee_le ? (
            <div>
              <dt>{tr("Close le", "Closed on")}</dt>
              <dd>{formaterDateHeure(o.cloturee_le, "Africa/Abidjan", langue)}</dd>
            </div>
          ) : null}
          {o.motif_perte ? (
            <div>
              <dt>{tr("Motif de la perte", "Reason for the loss")}</dt>
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
          {tr("Propositions", "Proposals")}
        </h2>
        {!propositions.ok ? (
          <EtatErreur
            titre={tr(
              "Les propositions n'ont pas pu être chargées.",
              "The proposals could not be loaded.",
            )}
            message={propositions.message}
            hrefReessayer={`/pipeline/${id}`}
          />
        ) : listePropositions.length === 0 ? (
          <EtatVide
            titre={tr(
              "Aucune proposition pour cette opportunité.",
              "No proposal for this opportunity.",
            )}
            icone="facture"
          >
            {ouverte ? (
              <p>
                {tr(
                  "Générez la proposition depuis un type du catalogue : découpage et jours par grade arrivent pré-remplis.",
                  "Generate the proposal from a catalog type: the work breakdown and days per grade come prefilled.",
                )}
              </p>
            ) : null}
          </EtatVide>
        ) : (
          <Tableau
            legende={tr("Versions de la proposition", "Proposal versions")}
            lignes={listePropositions}
            cleLigne={(p) => p.id}
            colonnes={[
              {
                cle: "numero",
                entete: tr("Version", "Version"),
                rendu: (p) => (
                  <Link href={`/pipeline/propositions/${p.id}`} className="mp-lien-ligne">
                    {`${tr("Version", "Version")} ${p.numero}`}
                  </Link>
                ),
              },
              { cle: "intitule", entete: tr("Intitulé", "Title") },
              { cle: "type", entete: tr("Type", "Type"), rendu: (p) => nomType(p.type_mission_id) },
              {
                cle: "devise",
                entete: tr("Devise", "Currency"),
                rendu: (p) => libelleDevise(p.devise),
              },
              {
                cle: "statut",
                entete: tr("Statut", "Status"),
                rendu: (p) => (
                  <BadgeStatut tonalite={statutProposition(p.statut, langue).tonalite}>
                    {statutProposition(p.statut, langue).libelle}
                  </BadgeStatut>
                ),
              },
              {
                cle: "cree",
                entete: tr("Créée le", "Created on"),
                rendu: (p) => formaterDateHeure(p.cree_le, "Africa/Abidjan", langue),
              },
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
        nomElement={tr(`l'opportunité ${o.intitule}`, `the opportunity ${o.intitule}`)}
      />
    </div>
  );
}
