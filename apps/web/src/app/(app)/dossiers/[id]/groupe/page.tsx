import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission, VUES_GROUPE } from "@missionpilot/shared";
import { ArbreGroupe } from "../../../../../components/dossier/ArbreGroupe";
import { ConsolidationGroupe } from "../../../../../components/dossier/ConsolidationGroupe";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { FormulaireParticipation } from "../../../../../components/dossier/FormulaireParticipation";
import { HistoriqueParticipations } from "../../../../../components/dossier/HistoriqueParticipations";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { VueDossier } from "../../../../../lib/dossier";
import {
  cheminGroupe,
  formaterDateJour,
  LIBELLES_VUES,
  lireParametresGroupe,
  participationsActives,
} from "../../../../../lib/dossier-groupes";
import { chargerGroupe, chargerParticipations } from "../../../../../lib/dossier-groupes-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Groupe du dossier" };

/**
 * Groupe et filiales du dossier (DOS-05) : structure de détention, consolidation simple,
 * saisie d'une participation (avec `dossier.ecrire`) et historique en ajout seul.
 */
export default async function PageGroupe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const parametres = lireParametresGroupe(await searchParams);
  const [dossier, groupe, historique] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerGroupe(id, parametres),
    chargerParticipations(id),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !groupe.ok || !historique.ok) {
    const message = !dossier.ok
      ? dossier.message
      : !groupe.ok
        ? groupe.message
        : !historique.ok
          ? historique.message
          : "";
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Groupe du dossier"
          retour={{ href: `/dossiers/${id}`, libelle: "Dossier" }}
        />
        <EtatErreur
          titre="Le groupe du dossier n'a pas pu être chargé."
          message={message}
          hrefReessayer={cheminGroupe(id, parametres)}
        />
      </div>
    );
  }

  const g = groupe.donnees;
  const participations = historique.donnees.elements;
  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />

      <div className="mp-groupe">
        <Carte titre="Situation affichée" niveauTitre={2}>
          <p>
            Situation au {formaterDateJour(g.date)}
            {g.exercice !== null ? `, exercice ${g.exercice}` : ", aucun exercice de référence"}.
          </p>
          <div className="mp-groupe-vues">
            <ul className="mp-groupe-vues__liens" aria-label="Point de départ de la lecture">
              {VUES_GROUPE.map((v) => (
                <li key={v}>
                  <Link
                    href={cheminGroupe(id, { ...parametres, vue: v })}
                    aria-current={g.vue === v ? "true" : undefined}
                  >
                    {LIBELLES_VUES[v]}
                    {g.vue === v ? " (affichée)" : ""}
                  </Link>
                </li>
              ))}
            </ul>
            <form method="get" className="mp-formulaire" aria-label="Choisir la date et l'exercice">
              <input type="hidden" name="vue" value={g.vue} />
              <div className="mp-grille-champs">
                <Champ
                  libelle="Situation au"
                  name="date"
                  type="date"
                  defaultValue={parametres.date ?? ""}
                />
                <Champ
                  libelle="Exercice"
                  name="exercice"
                  inputMode="numeric"
                  maxLength={4}
                  defaultValue={parametres.exercice ?? ""}
                  aide="Par défaut : le plus récent exercice accepté."
                />
              </div>
              <div className="mp-actions-formulaire">
                <Bouton type="submit" variante="secondaire">
                  Afficher
                </Bouton>
              </div>
            </form>
          </div>
        </Carte>

        <ArbreGroupe groupe={g} />
        <ConsolidationGroupe groupe={g} />

        {peutEcrire ? (
          <Carte titre="Saisir une participation" niveauTitre={2}>
            <FormulaireParticipation
              clientId={id}
              dateParDefaut={g.date}
              actives={participationsActives(participations, g.date)}
            />
          </Carte>
        ) : null}

        <HistoriqueParticipations participations={participations} />
      </div>
    </div>
  );
}
