import type { Metadata } from "next";
import Link from "next/link";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import {
  formaterMicroUsd,
  libelleSourceCle,
  LIMITE_PROMPTS,
  lireMois,
  moisDe,
  plafondBorne,
  presentationMode,
  voitCoutsIa,
  type CoutMissionIa,
  type CoutsIa,
  type PageIa,
  type ParametresIa,
  type PromptIa,
} from "../../../../lib/ia";
import { chargerFacultatif, type ChargementFacultatif } from "../../../../lib/ia-serveur";
import { exigerPermission } from "../../../../lib/session";
import { CleApiIa } from "./CleApiIa";
import { CoutsIaSection } from "./CoutsIa";
import { ActivationIa, TestConnexionIa } from "./EtatIa";
import { ModelesIa } from "./ModelesIa";
import { PlafondIa } from "./PlafondIa";
import { PromptsIa } from "./PromptsIa";

export const metadata: Metadata = { title: "Intelligence artificielle" };

const REFUSE = { etat: "refuse" } as const;

export default async function PageParametresIa({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("ia.configurer");
  const q = await searchParams;
  const maintenant = new Date();
  const mois = lireMois(q.mois, maintenant);
  const curseurMissions = typeof q.missions === "string" && q.missions !== "" ? q.missions : null;
  const voitCouts = voitCoutsIa(utilisateur.roles);
  const requeteMissions = new URLSearchParams({ limite: "30" });
  if (curseurMissions) requeteMissions.set("curseur", curseurMissions);

  const [p, prompts, couts, missions] = await Promise.all([
    chargerServeur<ParametresIa>("/api/ia/parametres"),
    chargerServeur<PageIa<PromptIa>>(`/api/ia/prompts?limite=${LIMITE_PROMPTS}`),
    voitCouts
      ? chargerFacultatif<CoutsIa>(`/api/ia/couts?mois=${mois}`)
      : Promise.resolve<ChargementFacultatif<CoutsIa>>(REFUSE),
    voitCouts
      ? chargerFacultatif<PageIa<CoutMissionIa>>(`/api/ia/couts/missions?${requeteMissions}`)
      : Promise.resolve<ChargementFacultatif<PageIa<CoutMissionIa>>>(REFUSE),
  ]);
  const mode = p.ok ? presentationMode(p.donnees) : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Intelligence artificielle"
        soustitre="Fournisseur OpenRouter, modèle par tâche, plafond de coût et prompts versionnés. L'IA propose, l'expert dispose : tout contenu généré reste un brouillon jusqu'à sa validation par un consultant, et aucun chiffre ne vient du modèle."
        badges={
          mode ? <BadgeStatut tonalite={mode.tonalite}>{mode.libelle}</BadgeStatut> : undefined
        }
        actions={
          <Link href="/parametres/ia/essai" className={classesBouton("secondaire")}>
            Essayer une génération
          </Link>
        }
      />
      {!p.ok ? (
        <EtatErreur
          titre="Les paramètres IA n'ont pas pu être chargés."
          message={p.message}
          hrefReessayer="/parametres/ia"
        />
      ) : (
        <ParametresCabinet p={p.donnees} />
      )}
      <Carte titre="Prompts versionnés">
        {prompts.ok ? (
          <PromptsIa initiale={prompts.donnees} />
        ) : (
          <EtatErreur
            titre="Les prompts n'ont pas pu être chargés."
            message={prompts.message}
            hrefReessayer="/parametres/ia"
          />
        )}
      </Carte>
      <CoutsIaSection
        mois={mois}
        moisCourant={moisDe(maintenant)}
        couts={couts}
        missions={missions}
        curseurMissions={curseurMissions}
      />
    </div>
  );
}

function ParametresCabinet({ p }: { p: ParametresIa }) {
  const mode = presentationMode(p);
  return (
    <>
      <Carte titre="État de l'IA">
        <div className="mp-pile">
          <p>{mode.explication}</p>
          <dl className="mp-liste-def">
            <div>
              <dt>Mode</dt>
              <dd>
                <BadgeStatut tonalite={mode.tonalite}>{mode.libelle}</BadgeStatut>
              </dd>
            </div>
            <div>
              <dt>IA du cabinet</dt>
              <dd>{p.ia_activee ? "Activée" : "Non activée"}</dd>
            </div>
            <div>
              <dt>Fournisseur</dt>
              <dd>OpenRouter</dd>
            </div>
            <div>
              <dt>Clé utilisée</dt>
              <dd>{libelleSourceCle(p.source_cle)}</dd>
            </div>
            {typeof p.plafond_effectif_micro_usd === "number" ? (
              <div>
                <dt>Plafond appliqué ce mois</dt>
                <dd>
                  {`${formaterMicroUsd(p.plafond_effectif_micro_usd)}${plafondBorne(p) ? " (borné par l'opérateur pour la clé de la plateforme)" : ""}`}
                </dd>
              </div>
            ) : null}
          </dl>
          <ActivationIa parametres={p} />
        </div>
      </Carte>
      <Carte titre="Clé API OpenRouter">
        <CleApiIa parametres={p} />
      </Carte>
      <Carte titre="Test de connexion">
        <TestConnexionIa iaActivee={p.ia_activee} cleDisponible={p.source_cle !== null} />
      </Carte>
      <Carte titre="Plafond mensuel de coût">
        <PlafondIa parametres={p} />
      </Carte>
      <Carte titre="Modèle par tâche">
        <ModelesIa modeles={p.modeles} autorises={p.modeles_autorises ?? []} />
      </Carte>
      {p.modifie_le ? (
        <p className="mp-texte-petit mp-texte-doux">
          Paramètres modifiés pour la dernière fois le {formaterDateHeure(p.modifie_le)}.
        </p>
      ) : null}
    </>
  );
}
