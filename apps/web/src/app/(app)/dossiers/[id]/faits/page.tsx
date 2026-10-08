import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { ActionsFait } from "../../../../../components/dossier/ActionsFait";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { FormulaireFait } from "../../../../../components/dossier/FormulaireFait";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  formaterSource,
  formaterValeurFait,
  grouperParCategorie,
  STATUT_FAIT,
  type Fait,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate, formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Faits du dossier" };

/** Tous les faits du dossier, historique compris ; ajout, confirmation, remplacement. */
export default async function PageFaits({
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
  const brut = (await searchParams).fait;
  const faitHistorique = typeof brut === "string" && estIdentifiant(brut) ? brut : null;
  const [dossier, faits, historique] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerServeur<{ elements: Fait[] }>(`/api/dossiers/${id}/faits?vue=tous`),
    faitHistorique
      ? chargerServeur<{ elements: Fait[] }>(
          `/api/dossiers/${id}/faits/${faitHistorique}/historique`,
        )
      : Promise.resolve(null),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !faits.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Faits du dossier"
          retour={{ href: `/dossiers/${id}`, libelle: "Dossier" }}
        />
        <EtatErreur
          titre="Les faits du dossier n'ont pas pu être chargés."
          message={!dossier.ok ? dossier.message : !faits.ok ? faits.message : ""}
          hrefReessayer={`/dossiers/${id}/faits`}
        />
      </div>
    );
  }

  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />

      {peutEcrire ? (
        <Carte titre="Ajouter un fait">
          <FormulaireFait clientId={id} />
        </Carte>
      ) : null}

      {historique ? (
        <Carte titre="Historique d'un fait">
          {historique.ok ? (
            <ol className="mp-pile">
              {historique.donnees.elements.map((f) => (
                <li key={f.id}>
                  <strong>{formaterValeurFait(f.valeur)}</strong> au {formaterDate(f.date_effet)}{" "}
                  <BadgeStatut tonalite={STATUT_FAIT[f.statut].tonalite}>
                    {STATUT_FAIT[f.statut].libelle}
                  </BadgeStatut>{" "}
                  — enregistré le {formaterDateHeure(f.cree_le)} par {f.auteur.nom}
                  {f.decision?.motif ? ` ; motif : ${f.decision.motif}` : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p>{historique.message}</p>
          )}
        </Carte>
      ) : null}

      {faits.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun fait dans ce dossier." icone="trombone">
          <p>
            Ajoutez les faits datés et sourcés connus du client : effectif, actionnariat, marchés…
          </p>
        </EtatVide>
      ) : (
        grouperParCategorie(faits.donnees.elements).map((g) => (
          <Carte key={g.categorie} titre={g.libelle}>
            <Tableau
              legende={`Faits : ${g.libelle}`}
              lignes={g.faits}
              cleLigne={(f) => f.id}
              colonnes={[
                {
                  cle: "cle",
                  entete: "Fait",
                  rendu: (f) => (
                    <Link href={`/dossiers/${id}/faits?fait=${f.id}`} className="mp-lien-ligne">
                      {f.cle}
                    </Link>
                  ),
                },
                { cle: "valeur", entete: "Valeur", rendu: (f) => formaterValeurFait(f.valeur) },
                {
                  cle: "date_effet",
                  entete: "Date d'effet",
                  rendu: (f) => formaterDate(f.date_effet),
                },
                {
                  cle: "source",
                  entete: "Source",
                  rendu: (f) => `${formaterSource(f.source)} (${f.fiabilite})`,
                },
                {
                  cle: "statut",
                  entete: "Statut",
                  rendu: (f) => (
                    <BadgeStatut tonalite={STATUT_FAIT[f.statut].tonalite}>
                      {STATUT_FAIT[f.statut].libelle}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "actions",
                  entete: "Actions",
                  rendu: (f) =>
                    peutEcrire && (f.statut === "propose" || f.statut === "confirme") ? (
                      <ActionsFait clientId={id} fait={f} utilisateurId={utilisateur.id} />
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Carte>
        ))
      )}
    </div>
  );
}
