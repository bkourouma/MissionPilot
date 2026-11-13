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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { CleApiIa } from "./CleApiIa";
import { CoutsIaSection } from "./CoutsIa";
import { CacheIa } from "./CacheIa";
import { ActivationIa, TestConnexionIa } from "./EtatIa";
import { ModelesIa } from "./ModelesIa";
import { PlafondIa } from "./PlafondIa";
import { PromptsIa } from "./PromptsIa";
import { RoutageIa } from "./RoutageIa";
import { lireEtatCache, lireRoutage } from "./routage-cache";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Intelligence artificielle", "Artificial intelligence") };
}

const REFUSE = { etat: "refuse" } as const;

export default async function PageParametresIa({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("ia.configurer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
  const mode = p.ok ? presentationMode(p.donnees, langue) : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Intelligence artificielle", "Artificial intelligence")}
        soustitre={t(
          "Fournisseur OpenRouter, modèle par tâche, plafond de coût et prompts versionnés. L'IA propose, l'expert dispose : tout contenu généré reste un brouillon jusqu'à sa validation par un consultant, et aucun chiffre ne vient du modèle.",
          "OpenRouter provider, model per task, cost ceiling and versioned prompts. AI proposes, the expert decides: any generated content remains a draft until a consultant approves it, and no figure comes from the model.",
        )}
        badges={
          mode ? <BadgeStatut tonalite={mode.tonalite}>{mode.libelle}</BadgeStatut> : undefined
        }
        actions={
          <Link href="/parametres/ia/essai" className={classesBouton("secondaire")}>
            {t("Essayer une génération", "Try a generation")}
          </Link>
        }
      />
      {!p.ok ? (
        <EtatErreur
          titre={t(
            "Les paramètres IA n'ont pas pu être chargés.",
            "The AI settings could not be loaded.",
          )}
          message={p.message}
          hrefReessayer="/parametres/ia"
        />
      ) : (
        <ParametresCabinet p={p.donnees} />
      )}
      <Carte titre={t("Prompts versionnés", "Versioned prompts")}>
        {prompts.ok ? (
          <PromptsIa initiale={prompts.donnees} />
        ) : (
          <EtatErreur
            titre={t("Les prompts n'ont pas pu être chargés.", "The prompts could not be loaded.")}
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

async function ParametresCabinet({ p }: { p: ParametresIa }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const mode = presentationMode(p, langue);
  return (
    <>
      <Carte titre={t("État de l'IA", "AI status")}>
        <div className="mp-pile">
          <p>{mode.explication}</p>
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Mode", "Mode")}</dt>
              <dd>
                <BadgeStatut tonalite={mode.tonalite}>{mode.libelle}</BadgeStatut>
              </dd>
            </div>
            <div>
              <dt>{t("IA du cabinet", "Firm AI")}</dt>
              <dd>{p.ia_activee ? t("Activée", "Enabled") : t("Non activée", "Not enabled")}</dd>
            </div>
            <div>
              <dt>{t("Fournisseur", "Provider")}</dt>
              <dd>OpenRouter</dd>
            </div>
            <div>
              <dt>{t("Clé utilisée", "Key used")}</dt>
              <dd>{libelleSourceCle(p.source_cle, langue)}</dd>
            </div>
            {typeof p.plafond_effectif_micro_usd === "number" ? (
              <div>
                <dt>{t("Plafond appliqué ce mois", "Ceiling applied this month")}</dt>
                <dd>
                  {`${formaterMicroUsd(p.plafond_effectif_micro_usd, langue)}${plafondBorne(p) ? t(" (borné par l'opérateur pour la clé de la plateforme)", " (capped by the operator for the platform key)") : ""}`}
                </dd>
              </div>
            ) : null}
          </dl>
          <ActivationIa parametres={p} />
        </div>
      </Carte>
      <Carte titre={t("Clé API OpenRouter", "OpenRouter API key")}>
        <CleApiIa parametres={p} />
      </Carte>
      <Carte titre={t("Test de connexion", "Connection test")}>
        <TestConnexionIa iaActivee={p.ia_activee} cleDisponible={p.source_cle !== null} />
      </Carte>
      <Carte titre={t("Plafond mensuel de coût", "Monthly cost ceiling")}>
        <PlafondIa parametres={p} />
      </Carte>
      <Carte titre={t("Modèle par tâche", "Model per task")}>
        <ModelesIa modeles={p.modeles} autorises={p.modeles_autorises ?? []} />
      </Carte>
      <Carte titre={t("Routage des modèles par tâche", "Model routing per task")}>
        <RoutageIa routage={lireRoutage(p)} />
      </Carte>
      <Carte titre={t("Cache des réponses", "Response cache")}>
        <CacheIa etat={lireEtatCache(p)} />
      </Carte>
      {p.modifie_le ? (
        <p className="mp-texte-petit mp-texte-doux">
          {t(
            `Paramètres modifiés pour la dernière fois le ${formaterDateHeure(p.modifie_le)}.`,
            `Settings last modified on ${formaterDateHeure(p.modifie_le, undefined, langue)}.`,
          )}
        </p>
      ) : null}
    </>
  );
}
