import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { RedCreancierVue, RedCreanceVue } from "@missionpilot/shared";
import { EcheancierAccord } from "../../../../../../../components/redressement/EcheancierAccord";
import { EtatContexteRed } from "../../../../../../../components/redressement/EtatsContexte";
import { FilNegociation } from "../../../../../../../components/redressement/FilNegociation";
import {
  FormulaireCreance,
  FormulaireModificationCreancier,
} from "../../../../../../../components/redressement/FormulaireCreancier";
import {
  FormulaireEvenement,
  RompreAccord,
} from "../../../../../../../components/redressement/FormulaireEvenement";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { aujourdhui as aujourdhuiIso } from "../../../../../../../lib/periode";
import {
  BANDEAU_CONFIDENTIALITE,
  cheminCreancier,
  hrefCreancierRed,
  hrefRedressement,
  libelleCategorieCreancier,
  libelleStatutAccord,
  raisonSansEcriture,
  tonaliteStatutAccord,
} from "../../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Créancier du redressement" };

/**
 * Fiche d'un créancier : créance courante et historique des versions, mise à jour de la créance,
 * fil de négociation, formulaire d'événement, accord en vigueur et son échéancier, rupture.
 * Situation, imputation et statut de l'accord : calculés par l'API à chaque lecture.
 */
export default async function PageCreancier({
  params,
}: {
  params: Promise<{ id: string; creancierId: string }>;
}) {
  const { id, creancierId } = await params;
  if (!estIdentifiant(creancierId)) notFound();
  const retour = hrefRedressement(id, "creanciers");
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefCreancierRed(id, creancierId)}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const r = await chargerServeur<RedCreancierVue>(cheminCreancier(creancierId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Le créancier n'a pas pu être chargé."
        message={r.message}
        hrefReessayer={hrefCreancierRed(id, creancierId)}
      />
    );
  }
  const c = r.donnees;
  const devise = dossier.devise;
  const m = (v: number) => formaterMontantMineur(v, devise);
  const jour = aujourdhuiIso();
  const accord = c.accord_en_vigueur;
  const restantes = c.situation.accord?.echeances_restantes ?? [];

  return (
    <div className="mp-red">
      <EnteteDePage
        titre={c.nom}
        retour={{ href: retour, libelle: "Créanciers" }}
        soustitre={`${libelleCategorieCreancier(c.categorie)}${c.garanti ? " · créance garantie" : ""}${c.reference ? ` · réf. ${c.reference}` : ""}`}
        badges={
          c.situation.accord ? (
            <BadgeStatut tonalite={tonaliteStatutAccord(c.situation.accord.statut)}>
              Accord : {libelleStatutAccord(c.situation.accord.statut)}
            </BadgeStatut>
          ) : null
        }
      />
      <Alerte tonalite="info" annonce="aucune">
        <p>{BANDEAU_CONFIDENTIALITE}</p>
      </Alerte>

      <div className="mp-red-cartes">
        <Carte titre="Encours restant" niveauTitre={3}>
          <p className="mp-red-chiffre mp-red-valeur">{m(c.situation.encours_restant)}</p>
          <p className="mp-texte-doux mp-texte-petit">
            Encours initial : {m(c.situation.encours_initial)}
          </p>
        </Carte>
        <Carte titre="Dont échu" niveauTitre={3}>
          <p className="mp-red-chiffre mp-red-valeur">{m(c.situation.echu)}</p>
        </Carte>
        <Carte titre="Créance courante" niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>Version</dt>
              <dd>{c.version_creance}</dd>
            </div>
            <div>
              <dt>Principal</dt>
              <dd className="mp-red-valeur">{m(c.principal)}</dd>
            </div>
            <div>
              <dt>Intérêts et pénalités</dt>
              <dd className="mp-red-valeur">{m(c.interets)}</dd>
            </div>
            <div>
              <dt>Arrêtée au</dt>
              <dd>{formaterDate(c.date_arrete)}</dd>
            </div>
            {c.echeance_initiale ? (
              <div>
                <dt>Échéance initiale</dt>
                <dd>{formaterDate(c.echeance_initiale)}</dd>
              </div>
            ) : null}
          </dl>
        </Carte>
      </div>

      {accord ? (
        <Carte titre="Accord en vigueur">
          <EcheancierAccord
            accord={accord}
            situation={c.situation}
            devise={devise}
            annulation={droits.ecrire ? { creancierId: c.id, aujourdhui: jour } : undefined}
          />
          {droits.ecrire ? (
            <RompreAccord creancierId={c.id} accordId={accord.id} aujourdhui={jour} />
          ) : null}
        </Carte>
      ) : null}

      <Carte titre="Fil de négociation">
        <FilNegociation evenements={c.evenements} devise={devise} />
      </Carte>

      {droits.ecrire ? (
        <>
          <Carte titre="Ajouter un événement">
            <FormulaireEvenement
              key={`${c.evenements.length}-${accord?.id ?? "aucun"}`}
              creancierId={c.id}
              devise={devise}
              aujourdhui={jour}
              accord={accord ? { id: accord.id, restantes } : null}
            />
          </Carte>
          <Carte titre="Mettre à jour la créance">
            <FormulaireCreance
              key={c.version_creance}
              creancierId={c.id}
              devise={devise}
              courante={c}
            />
          </Carte>
          <Carte titre="Modifier le créancier">
            <FormulaireModificationCreancier
              key={`${c.nom}-${c.actif}-${c.garanti}`}
              creancierId={c.id}
              nom={c.nom}
              reference={c.reference}
              garanti={c.garanti}
              actif={c.actif}
            />
          </Carte>
        </>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}
        </p>
      )}

      <Carte titre="Historique des versions de la créance">
        <Tableau
          legende="Versions de la créance"
          colonnes={[
            { cle: "version", entete: "Version", rendu: (v: RedCreanceVue) => v.version },
            {
              cle: "principal",
              entete: "Principal",
              alignement: "droite",
              rendu: (v) => <span className="mp-red-valeur">{m(v.principal)}</span>,
            },
            {
              cle: "interets",
              entete: "Intérêts",
              alignement: "droite",
              rendu: (v) => <span className="mp-red-valeur">{m(v.interets)}</span>,
            },
            { cle: "arrete", entete: "Arrêtée au", rendu: (v) => formaterDate(v.date_arrete) },
            {
              cle: "auteur",
              entete: "Saisie par",
              rendu: (v) => `${v.saisi_par.nom}, le ${formaterDateHeure(v.cree_le)}`,
            },
            { cle: "commentaire", entete: "Commentaire", rendu: (v) => v.commentaire ?? "—" },
          ]}
          lignes={c.creances}
          cleLigne={(v) => v.id}
        />
      </Carte>
      <p>
        <Link href={retour}>Revenir au registre des créanciers</Link>
      </p>
    </div>
  );
}
